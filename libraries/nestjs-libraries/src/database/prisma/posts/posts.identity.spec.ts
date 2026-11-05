jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PostsRepository } from './posts.repository';
import { PostsService } from './posts.service';

const NULL_PROV = { agentName: null, workflowId: null, runId: null, externalRef: null, source: null };

function svc(row: any, fail = false) {
  const findFirst = fail ? jest.fn().mockRejectedValue(new Error('db')) : jest.fn().mockResolvedValue(row);
  const repo = new PostsRepository(
    { model: { post: { findFirst } } } as any,
    {} as any, {} as any, {} as any, {} as any, {} as any, {} as any
  );
  const service = Object.create(PostsService.prototype) as any;
  service._postRepository = repo;
  return { service, findFirst };
}

describe('PostsService.getPostIdentity', () => {
  it('maps actor and provenance columns', async () => {
    const { service } = svc({
      createdByType: 'API_KEY', createdByApiKeyId: 'k1',
      lastModifiedByType: 'SYSTEM', agentName: 'bot', source: 'mcp',
    });
    expect(await service.getPostIdentity('o1', 'p1')).toEqual({
      actor: { createdBy: { type: 'API_KEY', apiKeyId: 'k1' }, lastModifiedBy: { type: 'SYSTEM' } },
      provenance: { agentName: 'bot', workflowId: null, runId: null, externalRef: null, source: 'mcp' },
    });
  });

  it('returns nulls for a legacy row', async () => {
    const { service } = svc({});
    expect(await service.getPostIdentity('o1', 'p1')).toEqual({
      actor: { createdBy: null, lastModifiedBy: null },
      provenance: NULL_PROV,
    });
  });

  it('returns the all-null shape for a missing row and never throws', async () => {
    const empty = { actor: { createdBy: null, lastModifiedBy: null }, provenance: NULL_PROV };
    expect(await svc(null).service.getPostIdentity('o1', 'p1')).toEqual(empty);
    expect(await svc(null, true).service.getPostIdentity('o1', 'p1')).toEqual(empty);
  });

  it('always scopes the query by organizationId', async () => {
    const { service, findFirst } = svc({});
    await service.getPostIdentity('o1', 'p1');
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', organizationId: 'o1' });
  });
});
