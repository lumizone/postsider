import dns from 'node:dns/promises';
import { isBlockedIp, isSafePublicHttpsUrl } from './webhook.url.validator';

describe('webhook URL SSRF validation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::ffff:10.0.0.1',
    '::ffff:a00:1',
    '::ffff:169.254.1.1',
    '::ffff:a9fe:101',
  ])('blocks IPv4-mapped IPv6 private address %s', (address) => {
    expect(isBlockedIp(address)).toBe(true);
  });

  it('allows a mapped public IPv4 address', () => {
    expect(isBlockedIp('::ffff:808:808')).toBe(false);
  });

  it.each([
    '::7f00:1', // IPv4-compatible hex: 127.0.0.1
    '::127.0.0.1', // IPv4-compatible dotted
    '::ffff:0:7f00:1', // IPv4-translated hex: 127.0.0.1
    '::ffff:0:127.0.0.1', // IPv4-translated dotted
    '0:0:0:0:ffff:0:7f00:1', // full (uncompressed) translated form
    '64:ff9b::7f00:1', // NAT64 well-known prefix: 127.0.0.1
    '64:ff9b::a00:1', // NAT64 well-known prefix: 10.0.0.1
  ])('blocks IPv6 IPv4-embedded private address %s', (address) => {
    expect(isBlockedIp(address)).toBe(true);
  });

  it.each(['::808:808', '64:ff9b::808:808', '::ffff:808:808'])(
    'allows IPv6 IPv4-embedded public address %s',
    (address) => {
      expect(isBlockedIp(address)).toBe(false);
    }
  );

  it('does not flag an ordinary public IPv6 address as an embedded IPv4', () => {
    expect(isBlockedIp('2001:db8::1')).toBe(false);
  });

  it.each(['fe80::1', 'fe90::1', 'fea0::1', 'febf::1'])(
    'blocks IPv6 link-local address %s across fe80::/10',
    (address) => {
      expect(isBlockedIp(address)).toBe(true);
    }
  );

  it.each(['fec0::1', 'feff::1'])(
    'blocks IPv6 site-local address %s across fec0::/10',
    (address) => {
      expect(isBlockedIp(address)).toBe(true);
    }
  );

  it('rejects a mapped IPv6 literal URL', async () => {
    await expect(
      isSafePublicHttpsUrl('https://[::ffff:7f00:1]/hook')
    ).resolves.toBe(false);
  });

  it('rejects an IPv4-compatible IPv6 literal URL', async () => {
    await expect(isSafePublicHttpsUrl('https://[::7f00:1]/hook')).resolves.toBe(
      false
    );
  });

  it('rejects an IPv4-translated IPv6 literal URL', async () => {
    await expect(
      isSafePublicHttpsUrl('https://[::ffff:0:7f00:1]/hook')
    ).resolves.toBe(false);
  });

  it('rejects a NAT64 IPv6 literal URL', async () => {
    await expect(
      isSafePublicHttpsUrl('https://[64:ff9b::7f00:1]/hook')
    ).resolves.toBe(false);
  });

  it('rejects an IPv6 link-local literal URL at the end of fe80::/10', async () => {
    await expect(
      isSafePublicHttpsUrl('https://[febf::1]/hook')
    ).resolves.toBe(false);
  });

  it('rejects a mapped IPv6 address returned by DNS', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '::ffff:a9fe:101', family: 6 }] as any);

    await expect(
      isSafePublicHttpsUrl('https://hooks.example.test/path')
    ).resolves.toBe(false);
  });

  it('rejects an IPv6 link-local address returned by DNS', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: 'fe90::1', family: 6 }] as any);

    await expect(
      isSafePublicHttpsUrl('https://hooks.example.test/path')
    ).resolves.toBe(false);
  });
});
