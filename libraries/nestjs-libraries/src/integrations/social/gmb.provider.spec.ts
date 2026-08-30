import { GmbProvider } from './gmb.provider';

describe('GmbProvider media validation', () => {
  const provider = new GmbProvider();

  it.each(['mp4', 'webm', 'mov', 'mkv'])(
    'rejects .%s video attachments',
    async (extension) => {
      await expect(
        provider.checkValidity(
          [[{ path: `https://cdn.example/clip.${extension}` }]],
          {}
        )
      ).resolves.toContain('only support image attachments');
    }
  );
});
