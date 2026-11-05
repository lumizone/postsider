import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CustomerNameDto } from './customer.dto';

const check = async (body: unknown) => {
  const dto = plainToInstance(CustomerNameDto, body as object);
  const errors = await validate(dto);
  return { dto, props: errors.map((e) => e.property) };
};

describe('CustomerNameDto', () => {
  it('accepts a normal name and trims it', async () => {
    const { dto, props } = await check({ name: '  Acme Corp  ' });
    expect(props).toEqual([]);
    expect(dto.name).toBe('Acme Corp');
  });

  it('rejects empty, blank and missing names', async () => {
    expect((await check({ name: '' })).props).toContain('name');
    expect((await check({ name: '   ' })).props).toContain('name');
    expect((await check({})).props).toContain('name');
  });

  it('rejects non strings', async () => {
    expect((await check({ name: 5 })).props).toContain('name');
    expect((await check({ name: { contains: '' } })).props).toContain('name');
  });

  it('enforces the 100 character limit', async () => {
    expect((await check({ name: 'a'.repeat(100) })).props).toEqual([]);
    expect((await check({ name: 'a'.repeat(101) })).props).toContain('name');
  });

  it('rejects control characters', async () => {
    expect((await check({ name: 'a\u0000b' })).props).toContain('name');
    expect((await check({ name: 'a\nb' })).props).toContain('name');
    expect((await check({ name: 'a\u007fb' })).props).toContain('name');
  });
});
