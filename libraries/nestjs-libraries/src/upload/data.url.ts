/**
 * Parses a `data:` URL into a Buffer and its mime type.
 *
 * gpt-image models only return base64 image data (never a URL), so the image
 * generation flow hands `uploadSimple` a data URL instead of a remote URL.
 *
 * Returns null when the value is not a valid data URL.
 */
export function parseDataUrl(
  value: string
): { buffer: Buffer; mime: string } | null {
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(value);
  if (!match) {
    return null;
  }

  const mime = match[1] || 'application/octet-stream';
  const isBase64 = !!match[2];
  const data = match[3];

  let buffer: Buffer;
  if (isBase64) {
    buffer = Buffer.from(data, 'base64');
  } else {
    try {
      buffer = Buffer.from(decodeURIComponent(data), 'utf-8');
    } catch {
      // Malformed percent-encoding (e.g. %zz) would throw a URIError — the
      // documented contract is "returns null when not valid".
      return null;
    }
  }

  return { buffer, mime };
}
