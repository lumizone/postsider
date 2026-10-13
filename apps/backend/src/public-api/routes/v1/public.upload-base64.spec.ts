jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

// file-type is ESM-only and jest runs CommonJS here, so stand in a magic-byte
// sniffer. The real detector is covered where it is defined.
jest.mock('@postsider/nestjs-libraries/upload/detect-file-type', () => ({
  detectFileType: async (buffer: Buffer) =>
    buffer.subarray(1, 4).toString() === 'PNG'
      ? { mime: 'image/png', ext: 'png' }
      : undefined,
}));

import { PublicIntegrationsController } from './public.integrations.controller';

// 1x1 transparent PNG
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('PublicIntegrationsController.uploadBase64', () => {
  const org = { id: 'org-1' } as any;
  const saveFile = jest.fn().mockResolvedValue({ id: 'm1', path: 'image/x.png' });
  const uploadFile = jest
    .fn()
    .mockResolvedValue({ originalname: 'x.png', path: 'image/x.png', kind: 'image' });

  const controller = () => {
    const c = Object.create(PublicIntegrationsController.prototype) as any;
    c._mediaService = { saveFile };
    c.storage = { uploadFile };
    return c as PublicIntegrationsController;
  };

  beforeEach(() => jest.clearAllMocks());

  it('stores a valid PNG, accepting a data: URL, and records the name', async () => {
    const result = await controller().uploadBase64(org, {
      data: `data:image/png;base64,${PNG}`,
      filename: 'logo.png',
    });
    expect(result).toEqual({ id: 'm1', path: 'image/x.png' });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0][0]).toBe('org-1');
    expect(saveFile.mock.calls[0][3]).toBe('logo.png');
  });

  it('rejects missing and non-base64 data without storing anything', async () => {
    await expect(controller().uploadBase64(org, {})).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      controller().uploadBase64(org, { data: 'not base64 !!' })
    ).rejects.toMatchObject({ status: 400 });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects bytes that are not an allowed media type', async () => {
    const text = Buffer.from('just some text, not an image').toString('base64');
    await expect(
      controller().uploadBase64(org, { data: text })
    ).rejects.toMatchObject({ status: 400 });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload before decoding it', async () => {
    await expect(
      controller().uploadBase64(org, { data: 'A'.repeat(40 * 1024 * 1024) })
    ).rejects.toMatchObject({ status: 413 });
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
