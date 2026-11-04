jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PostsService } from './posts.service';

describe('PostsService.startWorkflow', () => {
  const build = () => {
    const start = jest.fn().mockResolvedValue(undefined);
    const service: any = Object.create(PostsService.prototype);
    service._logger = { warn: jest.fn() };
    service._temporalService = {
      client: {
        getRawClient: () => ({
          workflow: {
            list: () => (async function* () {})(),
            start,
          },
        }),
      },
    };
    return { service, start };
  };

  it('starts postWorkflowV109 for a QUEUE post', async () => {
    const { service, start } = build();
    await service.startWorkflow('x', 'p1', 'org-1', 'QUEUE');
    expect(start).toHaveBeenCalledWith(
      'postWorkflowV109',
      expect.objectContaining({
        workflowId: 'post_p1',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      })
    );
  });

  it('does not start a workflow for a DRAFT', async () => {
    const { service, start } = build();
    await service.startWorkflow('x', 'p1', 'org-1', 'DRAFT');
    expect(start).not.toHaveBeenCalled();
  });
});
