import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListAgentActivityDto } from './list-agent-activity.dto';

const check = async (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListAgentActivityDto, query);
  const errors = await validate(dto);
  return { dto, props: errors.map((e) => e.property) };
};

describe('ListAgentActivityDto', () => {
  it('applies defaults', async () => {
    const { dto, props } = await check({});
    expect(props).toEqual([]);
    expect(dto.bucket).toBe('attention');
    expect(dto.scope).toBe('relevant');
    expect(dto.limit).toBe(25);
  });

  it('transforms limit from a string and bounds it to 1..50', async () => {
    expect((await check({ limit: '30' })).dto.limit).toBe(30);
    expect((await check({ limit: '0' })).props).toContain('limit');
    expect((await check({ limit: '51' })).props).toContain('limit');
    expect((await check({ limit: 'abc' })).props).toContain('limit');
    expect((await check({ limit: '1.5' })).props).toContain('limit');
  });

  it('splits integrationIds and drops blanks', async () => {
    const { dto, props } = await check({ integrationIds: 'a,b, ,c' });
    expect(props).toEqual([]);
    expect(dto.integrationIds).toEqual(['a', 'b', 'c']);
  });

  it('allows 20 integrationIds and rejects 21', async () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`).join(',');
    expect((await check({ integrationIds: ids(20) })).props).toEqual([]);
    expect((await check({ integrationIds: ids(21) })).props).toContain('integrationIds');
  });

  it('rejects an unknown bucket or scope', async () => {
    expect((await check({ bucket: 'nope' })).props).toContain('bucket');
    expect((await check({ scope: 'everything' })).props).toContain('scope');
    expect((await check({ bucket: 'unknown_outcome', scope: 'automation' })).props).toEqual([]);
  });

  it('bounds agentName and source to 255 characters', async () => {
    expect((await check({ agentName: 'a'.repeat(255) })).props).toEqual([]);
    expect((await check({ agentName: 'a'.repeat(256) })).props).toContain('agentName');
    expect((await check({ source: 's'.repeat(256) })).props).toContain('source');
  });

  it('accepts ISO dates and rejects other text', async () => {
    expect(
      (await check({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-02' })).props
    ).toEqual([]);
    expect((await check({ from: 'yesterday' })).props).toContain('from');
    expect((await check({ to: 'tomorrow' })).props).toContain('to');
  });
});
