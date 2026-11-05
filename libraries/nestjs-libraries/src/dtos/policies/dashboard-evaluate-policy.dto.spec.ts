import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DashboardEvaluatePolicyDto } from './dashboard-evaluate-policy.dto';

const base = {
  type: 'schedule',
  date: '2030-01-01T00:00:00.000Z',
  posts: [{ integration: { id: 'c1' }, value: [{ content: 'hi' }] }],
};

const failing = async (patch: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(DashboardEvaluatePolicyDto, { ...base, ...patch }) as object);
  return errors.map((e) => e.property);
};

describe('DashboardEvaluatePolicyDto', () => {
  it('accepts a body without asActor', async () => {
    expect(await failing({})).toEqual([]);
  });

  it('accepts each actor type, apiKeyId only with API_KEY', async () => {
    expect(await failing({ asActor: { type: 'USER' } })).toEqual([]);
    expect(await failing({ asActor: { type: 'SYSTEM' } })).toEqual([]);
    expect(await failing({ asActor: { type: 'OAUTH_CLIENT' } })).toEqual([]);
    expect(await failing({ asActor: { type: 'API_KEY' } })).toEqual([]);
    expect(await failing({ asActor: { type: 'API_KEY', apiKeyId: 'k1' } })).toEqual([]);
  });

  it('rejects an unknown actor type or a missing type', async () => {
    expect(await failing({ asActor: { type: 'ROBOT' } })).toContain('asActor');
    expect(await failing({ asActor: {} })).toContain('asActor');
    expect(await failing({ asActor: 'USER' })).toContain('asActor');
  });

  it('rejects apiKeyId with any other type, and a non-string or empty id', async () => {
    expect(await failing({ asActor: { type: 'USER', apiKeyId: 'k1' } })).toContain('asActor');
    expect(await failing({ asActor: { type: 'OAUTH_CLIENT', apiKeyId: 'k1' } })).toContain('asActor');
    expect(await failing({ asActor: { type: 'API_KEY', apiKeyId: 5 } })).toContain('asActor');
    expect(await failing({ asActor: { type: 'API_KEY', apiKeyId: '' } })).toContain('asActor');
  });

  it('still applies the inherited rules', async () => {
    expect(await failing({ posts: [] })).toContain('posts');
    expect(await failing({ type: 'nope' })).toContain('type');
  });
});
