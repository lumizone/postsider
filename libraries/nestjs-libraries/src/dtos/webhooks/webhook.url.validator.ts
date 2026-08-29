import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { URL } from 'node:url';
import dns from 'node:dns/promises';
import net from 'node:net';

export function isBlockedIPv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);

  if ([a, b].some((n) => Number.isNaN(n))) return true;

  return (
    a === 0 ||                       // 0.0.0.0/8
    a === 10 ||                      // 10.0.0.0/8
    a === 127 ||                     // 127.0.0.0/8
    (a === 169 && b === 254) ||      // 169.254.0.0/16
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||      // 192.168.0.0/16
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    a >= 224                         // multicast/reserved
  );
}

export function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  const firstHextet = Number.parseInt(normalized.split(':', 1)[0], 16);

  return (
    normalized === '::1' ||          // loopback
    normalized === '::' ||           // unspecified
    (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) || // link-local fe80::/10
    (firstHextet >= 0xfec0 && firstHextet <= 0xfeff) || // site-local fec0::/10
    normalized.startsWith('fc') ||   // unique local fc00::/7
    normalized.startsWith('fd') ||   // unique local fd00::/7
    normalized.startsWith('ff')      // multicast
  );
}

// Extracts an embedded IPv4 from an IPv6 that carries one in its final 32
// bits. Covers the IPv4-mapped (::ffff:a.b.c.d / ::ffff:x:y), the deprecated
// IPv4-compatible (::a.b.c.d / ::x:y, e.g. ::7f00:1 = 127.0.0.1), the legacy
// IPv4-translated (::ffff:0:a.b.c.d, e.g. ::ffff:0:7f00:1) and the RFC 6052
// NAT64 well-known (64:ff9b::/96) encodings — in dotted or hexadecimal form.
// Returns null when the address does not embed an IPv4 in a recognized prefix.
function ipv4EmbeddedInIpv6(ip: string): string | null {
  const normalized = ip.toLowerCase();
  const dottedTail = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  const address = dottedTail
    ? `${dottedTail[1]}${dottedTail[2]
        .split('.')
        .reduce<string[]>((groups, octet, index, octets) => {
          if (index % 2 === 0) {
            groups.push(
              ((Number(octet) << 8) | Number(octets[index + 1])).toString(16)
            );
          }
          return groups;
        }, [])
        .join(':')}`
    : normalized;
  const [beforeCompression, afterCompression] = address.split('::');
  const before = beforeCompression ? beforeCompression.split(':') : [];
  const after = afterCompression ? afterCompression.split(':') : [];
  const groups =
    afterCompression === undefined
      ? before
      : [
          ...before,
          ...Array(8 - before.length - after.length).fill('0'),
          ...after,
        ];

  if (groups.length !== 8) {
    return null;
  }

  const hextets = groups.map((group) => Number.parseInt(group, 16));
  if (hextets.some((h) => Number.isNaN(h))) {
    return null;
  }

  const allZero = (start: number, end: number) =>
    hextets.slice(start, end).every((h) => h === 0);

  const embedsV4 =
    allZero(0, 6) || // ::/96 IPv4-compatible (also catches :: and ::1)
    (allZero(0, 5) && hextets[5] === 0xffff) || // ::ffff:0:0/96 IPv4-mapped
    (allZero(0, 4) && hextets[4] === 0xffff && hextets[5] === 0) || // ::ffff:0:a.b.c.d IPv4-translated
    (hextets[0] === 0x0064 && hextets[1] === 0xff9b && allZero(2, 6)); // 64:ff9b::/96 NAT64

  if (!embedsV4) {
    return null;
  }

  const high = hextets[6];
  const low = hextets[7];
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    return isBlockedIPv4(ip);
  }
  if (version === 6) {
    // IPv4-mapped/compatible/translated IPv6 can encode its final 32 bits in
    // either dotted or hex form (::ffff:127.0.0.1, ::7f00:1, ::ffff:0:7f00:1).
    const embeddedV4 = ipv4EmbeddedInIpv6(ip);
    if (embeddedV4) {
      return isBlockedIPv4(embeddedV4);
    }
    return isBlockedIPv6(ip);
  }
  return true;
}

export async function isSafePublicHttpsUrl(value: unknown): Promise<boolean> {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  if (!parsed.hostname) {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (hostname === 'localhost') {
    return false;
  }

  // If user supplied a literal IP directly, validate it immediately
  const literalIpVersion = net.isIP(hostname);
  if (literalIpVersion) {
    return !isBlockedIp(hostname);
  }

  try {
    const records = await dns.lookup(hostname, { all: true });

    if (!records.length) {
      return false;
    }

    for (const record of records) {
      if (isBlockedIp(record.address)) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

@ValidatorConstraint({ name: 'IsSafeWebhookUrl', async: true })
export class IsSafeWebhookUrlConstraint implements ValidatorConstraintInterface {
  async validate(value: unknown, _args: ValidationArguments): Promise<boolean> {
    return isSafePublicHttpsUrl(value);
  }

  defaultMessage(_args: ValidationArguments): string {
    return 'URL must be a public HTTPS URL and must not resolve to localhost, private, loopback, or link-local addresses';
  }
}

export function IsSafeWebhookUrl(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: IsSafeWebhookUrlConstraint,
    });
  };
}
