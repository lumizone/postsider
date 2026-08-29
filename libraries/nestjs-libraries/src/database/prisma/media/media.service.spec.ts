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
    };
    const service = new MediaService(repository as any);
    const storage = { removeFile: jest.fn() };
    (service as any).storage = storage;

    await service.deleteMedia('org-1', 'media-1');

    expect(repository.getMediaById).toHaveBeenCalledWith('media-1', 'org-1');
    expect(storage.removeFile).not.toHaveBeenCalled();
  });
});
