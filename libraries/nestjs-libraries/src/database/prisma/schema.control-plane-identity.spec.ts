import { Prisma, PostActorType } from '@prisma/client';

const model = (name: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;
const field = (m: string, f: string) => model(m).fields.find((x) => x.name === f)!;

describe('control plane identity schema', () => {
  it('PostActorType has exactly four values', () => {
    expect(Object.values(PostActorType).sort()).toEqual(['API_KEY', 'OAUTH_CLIENT', 'SYSTEM', 'USER']);
  });
  it.each(['createdBy', 'lastModifiedBy'])('Post has the %s actor columns, nullable, no relation', (p) => {
    expect(field('Post', `${p}Type`)).toMatchObject({ type: 'PostActorType', isRequired: false });
    for (const s of ['UserId', 'ApiKeyId', 'OAuthClientId']) {
      expect(field('Post', `${p}${s}`)).toMatchObject({ type: 'String', isRequired: false, kind: 'scalar' });
    }
  });
  it.each(['agentName', 'workflowId', 'runId', 'externalRef', 'source'])('Post.%s is optional text', (f) => {
    expect(field('Post', f)).toMatchObject({ type: 'String', isRequired: false });
  });
  it('PostApproval has requester and decider attribution and guest identity', () => {
    for (const f of ['requestedByType', 'requestedByUserId', 'requestedByApiKeyId', 'requestedByOAuthClientId', 'decidedByType', 'guestName', 'guestEmail']) {
      expect(field('PostApproval', f).isRequired).toBe(false);
    }
    expect(field('PostApproval', 'decidedByType').type).toBe('PostActorType');
  });
  it('AuditLog has target, actor and metadata columns', () => {
    expect(field('AuditLog', 'targetType').isRequired).toBe(false);
    expect(field('AuditLog', 'actorType').type).toBe('PostActorType');
    expect(field('AuditLog', 'metadata').type).toBe('Json');
  });
});
