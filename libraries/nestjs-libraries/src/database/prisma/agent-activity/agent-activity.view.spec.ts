import { toGroupSummary, ActivityRow } from './agent-activity.view';
import type { ActorResolver } from './actor-directory.service';

const row = (over: Partial<ActivityRow> = {}): ActivityRow =>
  ({
    id: 'p1',
    group: 'g1',
    state: 'QUEUE',
    publishDate: new Date('2026-11-05T10:00:00.000Z'),
    updatedAt: new Date('2026-11-05T09:00:00.000Z'),
    content: '<p>Hello</p>',
    image: null,
    error: null,
    errorCategory: null,
    errorRetryable: null,
    publishAttempts: 0,
    releaseId: null,
    releaseURL: null,
    integrationId: 'i1',
    createdByType: null,
    createdByUserId: null,
    createdByApiKeyId: null,
    createdByOAuthClientId: null,
    lastModifiedByType: null,
    lastModifiedByUserId: null,
    lastModifiedByApiKeyId: null,
    lastModifiedByOAuthClientId: null,
    agentName: null,
    workflowId: null,
    runId: null,
    externalRef: null,
    source: null,
    integration: { id: 'i1', name: 'Chan', providerIdentifier: 'x', picture: null },
    ...over,
  }) as ActivityRow;

const noResolve: ActorResolver = () => null;

describe('toGroupSummary', () => {
  it('takes the highest priority bucket across destinations', () => {
    const s = toGroupSummary(
      [
        row({ id: 'a', state: 'QUEUE' }),
        row({ id: 'b', state: 'APPROVAL' }),
        row({ id: 'c', state: 'ERROR', errorCategory: 'UNKNOWN_OUTCOME' }),
      ],
      noResolve,
      []
    );
    expect(s.bucket).toBe('unknown_outcome');
    expect(s.destinations.map((d) => d.bucket)).toEqual([
      'scheduled',
      'review',
      'unknown_outcome',
    ]);
  });

  it('uses the max row updatedAt and the group id', () => {
    const s = toGroupSummary(
      [
        row({ updatedAt: new Date('2026-11-05T08:00:00.000Z') }),
        row({ id: 'p2', updatedAt: new Date('2026-11-05T11:00:00.000Z') }),
      ],
      noResolve,
      []
    );
    expect(s.updatedAt.toISOString()).toBe('2026-11-05T11:00:00.000Z');
    expect(s.group).toBe('g1');
  });

  it('canRetry is false when the failed destination has a real release id', () => {
    const failed = { state: 'ERROR', errorCategory: 'PROVIDER', errorRetryable: true };
    expect(
      toGroupSummary([row({ ...failed, releaseId: 'real-123' } as any)], noResolve, []).canRetry
    ).toBe(false);
    expect(
      toGroupSummary([row({ ...failed, releaseId: 'missing' } as any)], noResolve, []).canRetry
    ).toBe(true);
    expect(toGroupSummary([row({ ...failed } as any)], noResolve, []).canRetry).toBe(true);
  });

  it('canRetry covers unknown_outcome and failed_other and not review or blocked', () => {
    expect(
      toGroupSummary([row({ state: 'ERROR', errorCategory: 'UNKNOWN_OUTCOME' } as any)], noResolve, [])
        .canRetry
    ).toBe(true);
    expect(toGroupSummary([row({ state: 'ERROR' } as any)], noResolve, []).canRetry).toBe(true);
    expect(
      toGroupSummary([row({ state: 'ERROR', errorCategory: 'POLICY_BLOCKED' } as any)], noResolve, [])
        .canRetry
    ).toBe(false);
    expect(toGroupSummary([row({ state: 'APPROVAL' } as any)], noResolve, []).canRetry).toBe(false);
  });

  it('builds a plain text preview cut at 240 characters', () => {
    expect(
      toGroupSummary([row({ content: '<p>Hi <b>there</b></p>' })], noResolve, []).contentPreview
    ).toBe('Hi there');
    const long = toGroupSummary([row({ content: `<p>${'a'.repeat(300)}</p>` })], noResolve, []);
    expect(long.contentPreview).toHaveLength(240);
  });

  it('keeps all five claimed keys even when null', () => {
    const s = toGroupSummary([row()], noResolve, []);
    expect(s.claimed).toEqual({
      agentName: null,
      workflowId: null,
      runId: null,
      externalRef: null,
      source: null,
    });
    const c = toGroupSummary([row({ agentName: 'bot', source: 'cron' })], noResolve, []).claimed;
    expect(c.agentName).toBe('bot');
    expect(c.source).toBe('cron');
    expect(Object.keys(c)).toHaveLength(5);
  });

  it('passes pendingApprovalIds through', () => {
    expect(toGroupSummary([row()], noResolve, ['ap1', 'ap2']).pendingApprovalIds).toEqual([
      'ap1',
      'ap2',
    ]);
  });

  it('resolves actors of the first destination and gives null when columns are null', () => {
    const resolve: ActorResolver = jest.fn((v) =>
      v
        ? { type: v.type, id: v.apiKeyId ?? null, name: 'Key', state: 'ok', authorizedBy: null }
        : null
    ) as any;
    const s = toGroupSummary(
      [row({ createdByType: 'API_KEY', createdByApiKeyId: 'k1' } as any)],
      resolve,
      []
    );
    expect(s.createdBy?.name).toBe('Key');
    expect(s.lastModifiedBy).toBeNull();
    expect(resolve).toHaveBeenCalledWith({ type: 'API_KEY', apiKeyId: 'k1' });
  });

  it('exposes destination fields and no error text', () => {
    const s = toGroupSummary(
      [row({ state: 'ERROR', error: 'secret details', publishAttempts: 2, releaseURL: 'https://x/1' } as any)],
      noResolve,
      []
    );
    expect(s.destinations[0]).toEqual({
      postId: 'p1',
      integrationId: 'i1',
      integrationName: 'Chan',
      providerIdentifier: 'x',
      picture: null,
      state: 'ERROR',
      bucket: 'failed_other',
      errorCategory: null,
      errorRetryable: null,
      publishAttempts: 2,
      releaseURL: 'https://x/1',
      publishDate: new Date('2026-11-05T10:00:00.000Z'),
    });
  });
});
