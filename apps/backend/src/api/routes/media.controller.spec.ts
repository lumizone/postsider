jest.mock('@postsider/nestjs-libraries/upload/probe-dimensions', () => ({
  probeDimensions: jest
    .fn()
    .mockResolvedValue({ width: 120, height: 80, durationSeconds: 42 }),
}));

import { MediaController } from './media.controller';

describe('MediaController uploads', () => {
  it('does not expose the legacy client-key registration method', () => {
    expect((MediaController.prototype as any).saveMedia).toBeUndefined();
  });

  it('persists upload-simple media even when a legacy preventSave flag is sent', async () => {
    const media = {
      saveFile: jest.fn().mockResolvedValue({ id: 'media-1', path: 'https://cdn/media-1.jpg' }),
    };
    const controller = new MediaController(media as any, {} as any);
    const storage = {
      uploadFile: jest.fn().mockResolvedValue({
        originalname: 'media-1.jpg',
        path: 'https://cdn/media-1.jpg',
        kind: 'image',
      }),
    };
    (controller as any).storage = storage;

    const result = await controller.uploadSimple(
      { id: 'org-1' } as any,
      {
        originalname: 'source.jpg',
        mimetype: 'image/jpeg',
        size: 12,
        buffer: Buffer.from('not-an-image'),
      } as any
    );

    expect(media.saveFile).toHaveBeenCalledWith(
      'org-1',
      'media-1.jpg',
      'https://cdn/media-1.jpg',
      'source.jpg',
      'image',
      12,
      120,
      80,
      42
    );
    expect(result).toEqual({ id: 'media-1', path: 'https://cdn/media-1.jpg' });
  });
});
