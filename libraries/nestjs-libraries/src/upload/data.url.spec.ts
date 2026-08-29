import { DataUrlTooLargeError, parseDataUrl } from './data.url';

describe('parseDataUrl', () => {
  it('rejects an oversized base64 payload before decoding it', () => {
    const value = `data:image/png;base64,${Buffer.from('123456789').toString(
      'base64'
    )}`;

    expect(() => parseDataUrl(value, 8)).toThrow(DataUrlTooLargeError);
  });

  it('rejects an oversized percent-encoded payload before decoding it', () => {
    expect(() => parseDataUrl('data:text/plain,123456789', 8)).toThrow(
      DataUrlTooLargeError
    );
  });

  it('returns a bounded decoded payload', () => {
    expect(parseDataUrl('data:text/plain,hello', 5)).toEqual({
      buffer: Buffer.from('hello'),
      mime: 'text/plain',
    });
  });
});
