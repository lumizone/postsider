import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DecideApprovalDto, ListApprovalsQueryDto } from './public-approval.dto';

const errorsOf = (cls: any, plain: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, plain)).map((e) => e.property);

describe('ListApprovalsQueryDto', () => {
  it('accepts an empty query and every documented filter', () => {
    expect(errorsOf(ListApprovalsQueryDto, {})).toEqual([]);
    expect(
      errorsOf(ListApprovalsQueryDto, {
        status: 'PENDING',
        limit: '100',
        cursor: 'abc',
        since: '2026-11-01T00:00:00Z',
      })
    ).toEqual([]);
  });

  it.each([
    [{ limit: '101' }, 'limit'],
    [{ limit: '0' }, 'limit'],
    [{ limit: 'abc' }, 'limit'],
    [{ limit: '1.5' }, 'limit'],
    [{ status: 'pending' }, 'status'],
    [{ status: 'DONE' }, 'status'],
    [{ since: 'yesterday' }, 'since'],
    [{ cursor: 'x'.repeat(201) }, 'cursor'],
  ])('rejects %j', (plain, prop) => {
    expect(errorsOf(ListApprovalsQueryDto, plain)).toContain(prop);
  });

  it('coerces limit to a number', () => {
    expect(plainToInstance(ListApprovalsQueryDto, { limit: '7' }).limit).toBe(7);
  });
});

describe('DecideApprovalDto', () => {
  it('accepts no note, a short note and a 500 character note', () => {
    expect(errorsOf(DecideApprovalDto, {})).toEqual([]);
    expect(errorsOf(DecideApprovalDto, { note: 'ok' })).toEqual([]);
    expect(errorsOf(DecideApprovalDto, { note: 'x'.repeat(500) })).toEqual([]);
  });

  it('rejects a note over 500 characters or a non string note', () => {
    expect(errorsOf(DecideApprovalDto, { note: 'x'.repeat(501) })).toContain('note');
    expect(errorsOf(DecideApprovalDto, { note: 5 })).toContain('note');
  });
});
