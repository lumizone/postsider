import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EvaluatePolicyDto } from './evaluate-policy.dto';

const post = (over: Record<string, unknown> = {}) => ({
  integration: { id: 'c1' },
  value: [{ content: 'hi' }],
  ...over,
});
const base = { type: 'schedule', date: '2030-01-01T00:00:00.000Z', posts: [post()] };

const failing = async (patch: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(EvaluatePolicyDto, { ...base, ...patch }) as object);
  return errors.map((e) => e.property);
};

describe('EvaluatePolicyDto', () => {
  it('accepts a minimal body and tolerates unknown keys', async () => {
    expect(await failing({})).toEqual([]);
    expect(
      await failing({
        shortLink: true,
        tags: [{ value: 'x' }],
        posts: [post({ settings: { __type: 'x' }, firstComment: null })],
      })
    ).toEqual([]);
  });

  it('rejects an unknown type and a bad date', async () => {
    expect(await failing({ type: 'nope' })).toContain('type');
    expect(await failing({ type: undefined })).toContain('type');
    expect(await failing({ date: 'tomorrow' })).toContain('date');
    expect(await failing({ date: undefined })).toEqual([]);
  });

  it('requires 1 to 20 posts', async () => {
    expect(await failing({ posts: [] })).toContain('posts');
    expect(await failing({ posts: Array.from({ length: 21 }, () => post()) })).toContain('posts');
    expect(await failing({ posts: Array.from({ length: 20 }, () => post()) })).toEqual([]);
    expect(await failing({ posts: undefined })).toContain('posts');
  });

  it('requires 1 to 50 values per post and nested shapes', async () => {
    expect(await failing({ posts: [post({ value: [] })] })).toContain('posts');
    expect(
      await failing({ posts: [post({ value: Array.from({ length: 51 }, () => ({ content: 'a' })) })] })
    ).toContain('posts');
    expect(await failing({ posts: [post({ value: [{ content: 5 }] })] })).toContain('posts');
    expect(await failing({ posts: [post({ integration: {} })] })).toContain('posts');
    expect(await failing({ posts: [post({ value: [{ content: 'a', image: [{ path: 1 }] }] })] })).toContain('posts');
    expect(await failing({ posts: [post({ firstComment: 5 })] })).toContain('posts');
  });
});
