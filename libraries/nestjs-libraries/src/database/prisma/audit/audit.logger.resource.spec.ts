import { AuditLogger } from './audit.logger';
import { runWithActor } from '@postsider/nestjs-libraries/actor/actor-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function setup() {
  const create = jest.fn().mockResolvedValue({});
  const logger = new AuditLogger({ model: { auditLog: { create } } } as any);
  return { logger, create };
}

const base = {
  organizationId: 'o1',
  event: 'post.created' as const,
  targetType: 'post' as const,
  targetId: 'p1',
};

describe('AuditLogger.logResourceEvent', () => {
  it('writes the resource columns for an API key actor', async () => {
    const { logger, create } = setup();
    await runWithActor({ type: 'API_KEY', apiKeyId: 'k1' }, () => logger.logResourceEvent(base));
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: 'o1',
      operation: 'post.created',
      type: 'resource',
      targetType: 'post',
      targetId: 'p1',
      actorType: 'API_KEY',
      actorApiKeyId: 'k1',
      actorUserId: null,
      status: 'ok',
      inputHash: null,
    });
    expect(data.correlationId).toMatch(UUID);
  });

  it('sets actorUserId for a user actor', async () => {
    const { logger, create } = setup();
    await runWithActor({ type: 'USER', userId: 'u1' }, () => logger.logResourceEvent(base));
    expect(create.mock.calls[0][0].data).toMatchObject({ actorType: 'USER', actorUserId: 'u1' });
  });

  it('sets client and authorizing user for an OAuth actor', async () => {
    const { logger, create } = setup();
    await runWithActor({ type: 'OAUTH_CLIENT', oauthClientId: 'c1', userId: 'u7' }, () =>
      logger.logResourceEvent(base)
    );
    expect(create.mock.calls[0][0].data).toMatchObject({
      actorType: 'OAUTH_CLIENT',
      actorOAuthClientId: 'c1',
      actorUserId: 'u7',
    });
  });

  it('adds impersonatedBy only inside an impersonated run', async () => {
    const { logger, create } = setup();
    await runWithActor({ type: 'USER', userId: 'u1' }, () => logger.logResourceEvent(base), {
      impersonatedBy: 'admin-1',
    });
    expect(create.mock.calls[0][0].data.metadata).toMatchObject({ impersonatedBy: 'admin-1' });
    await runWithActor({ type: 'USER', userId: 'u1' }, () => logger.logResourceEvent(base));
    const meta = create.mock.calls[1][0].data.metadata;
    expect(meta == null || !('impersonatedBy' in meta)).toBe(true);
  });

  it('actor null stores no actor', async () => {
    const { logger, create } = setup();
    await logger.logResourceEvent({ ...base, actor: null });
    expect(create.mock.calls[0][0].data).toMatchObject({
      actorType: null,
      actorUserId: null,
      actorApiKeyId: null,
      actorOAuthClientId: null,
    });
  });

  it('defaults to SYSTEM outside a run', async () => {
    const { logger, create } = setup();
    await logger.logResourceEvent(base);
    expect(create.mock.calls[0][0].data.actorType).toBe('SYSTEM');
  });

  it('honours status error and sanitizes metadata', async () => {
    const { logger, create } = setup();
    await logger.logResourceEvent({
      ...base,
      status: 'error',
      metadata: { errorCategory: 'X', content: 'nope' } as any,
    });
    const data = create.mock.calls[0][0].data;
    expect(data.status).toBe('error');
    expect(data.metadata).toEqual({ errorCategory: 'X' });
  });

  it('never rejects when the write fails', async () => {
    const { logger, create } = setup();
    create.mockRejectedValue(new Error('db down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(logger.logResourceEvent(base)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('log security and auth events do not set targetType', async () => {
    const { logger, create } = setup();
    await logger.logSecurityEvent('o1', 'role.changed', 'u1');
    expect(create.mock.calls[0][0].data.targetType).toBeUndefined();
  });
});
