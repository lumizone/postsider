import { IntegrationRepository } from './integration.repository';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';

describe('IntegrationRepository.parkPostsForDeletedChannel', () => {
  it('parks posts as DRAFT and stamps the ambient actor', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const self = { _posts: { model: { post: { updateMany } } } };
    await runWithActor({ type: 'USER', userId: 'u1' }, () =>
      (IntegrationRepository.prototype.parkPostsForDeletedChannel as any).call(
        self,
        'org',
        'i1'
      )
    );
    expect(updateMany.mock.calls[0][0].where).toMatchObject({
      organizationId: 'org',
      integrationId: 'i1',
    });
    expect(updateMany.mock.calls[0][0].data).toMatchObject({
      state: 'DRAFT',
      lastModifiedByType: 'USER',
      lastModifiedByUserId: 'u1',
    });
  });
});
