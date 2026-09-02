import { MediaService } from './media.service';

describe('MediaService deletion', () => {
  it('never removes a blob when the media record is not owned by the caller', async () => {
    const repository = {
      getMediaById: jest.fn().mockResolvedValue({
        id: 'media-1',
        organizationId: 'other-org',
        path: 'https://cdn/other-org.jpg',
      }),
      deleteMedia: jest.fn().mockResolvedValue({ id: 'media-1' }),
      isMediaReferenced: jest.fn().mockResolvedValue(false),
    };
    const service = new MediaService(repository as any);
    const storage = { removeFile: jest.fn() };
    (service as any).storage = storage;

    await service.deleteMedia('org-1', 'media-1');

    expect(repository.getMediaById).toHaveBeenCalledWith('media-1', 'org-1');
    expect(storage.removeFile).not.toHaveBeenCalled();
  });

  it('soft-deletes but retains a blob referenced by an active post', async () => {
    const media = {
      id: 'media-1',
      organizationId: 'org-1',
      path: 'https://storage.example/image/media-1.jpg',
    };
    const repository = {
      getMediaById: jest.fn().mockResolvedValue(media),
      deleteMedia: jest.fn().mockResolvedValue(media),
      isMediaReferenced: jest.fn().mockResolvedValue(true),
    };
    const service = new MediaService(repository as any);
    const storage = { removeFile: jest.fn() };
    (service as any).storage = storage;

    await expect(service.deleteMedia('org-1', 'media-1')).resolves.toBe(media);

    expect(repository.deleteMedia).toHaveBeenCalledWith('org-1', 'media-1');
    expect(repository.isMediaReferenced).toHaveBeenCalledWith(
      'org-1',
      'media-1',
      media.path
    );
    expect(storage.removeFile).not.toHaveBeenCalled();
  });

  it('removes an unreferenced blob after soft-deleting the media row', async () => {
    const media = {
      id: 'media-1',
      organizationId: 'org-1',
      path: 'https://storage.example/image/media-1.jpg',
    };
    const repository = {
      getMediaById: jest.fn().mockResolvedValue(media),
      deleteMedia: jest.fn().mockResolvedValue(media),
      isMediaReferenced: jest.fn().mockResolvedValue(false),
    };
    const service = new MediaService(repository as any);
    const storage = { removeFile: jest.fn().mockResolvedValue(undefined) };
    (service as any).storage = storage;

    await service.deleteMedia('org-1', 'media-1');

    expect(storage.removeFile).toHaveBeenCalledWith(media.path);
  });
});
