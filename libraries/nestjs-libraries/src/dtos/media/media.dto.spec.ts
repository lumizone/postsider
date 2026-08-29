import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import dns from 'node:dns/promises';
import { MediaDto } from './media.dto';

async function expectValid(path: string) {
  const errors = await validate(plainToInstance(MediaDto, { id: 'media-1', path }));
  expect(errors).toEqual([]);
}

async function expectInvalid(path: string) {
  const errors = await validate(plainToInstance(MediaDto, { id: 'media-1', path }));
  expect(errors.length).toBeGreaterThan(0);
  const safePath = errors.find((e) => e.constraints?.checkSafeMediaPath);
  expect(safePath?.constraints?.checkSafeMediaPath).toContain('public HTTPS');
}

describe('MediaDto.path SSRF validation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows a storage-relative path without any DNS lookup', async () => {
    await expectValid('image/abc.png');
  });

  it('allows a public HTTPS URL', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as any);
    await expectValid('https://example.com/image/abc.png');
  });

  it('rejects a loopback literal', async () => {
    await expectInvalid('https://127.0.0.1/image/abc.png');
  });

  it('rejects a private address resolved by DNS', async () => {
    jest
      .spyOn(dns, 'lookup')
      .mockResolvedValue([{ address: '10.0.0.1', family: 4 }] as any);
    await expectInvalid('https://internal.example.com/image/abc.png');
  });

  it('rejects an IPv4-mapped IPv6 literal', async () => {
    await expectInvalid('https://[::ffff:7f00:1]/image/abc.png');
  });

  it('rejects an IPv4-compatible IPv6 literal', async () => {
    await expectInvalid('https://[::7f00:1]/image/abc.png');
  });

  it('rejects an IPv4-translated IPv6 literal', async () => {
    await expectInvalid('https://[::ffff:0:7f00:1]/image/abc.png');
  });

  it('rejects a non-HTTPS absolute URL', async () => {
    await expectInvalid('http://example.com/image/abc.png');
  });
});
