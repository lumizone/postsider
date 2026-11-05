import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BulkApprovalsDto, RetryFailedDto } from './agent-activity-actions.dto';

const bulk = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(BulkApprovalsDto, body))).map((e) => e.property);
const retry = async (body: Record<string, unknown>) =>
  (await validate(plainToInstance(RetryFailedDto, body))).map((e) => e.property);
const ids = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);

describe('BulkApprovalsDto', () => {
  it('accepts 1 and 50 distinct ids and an optional note', async () => {
    expect(await bulk({ action: 'approve', approvalIds: ids(1) })).toEqual([]);
    expect(await bulk({ action: 'reject', approvalIds: ids(50), note: 'x'.repeat(500) })).toEqual([]);
  });

  it('rejects 0 and 51 ids', async () => {
    expect(await bulk({ action: 'approve', approvalIds: [] })).toContain('approvalIds');
    expect(await bulk({ action: 'approve', approvalIds: ids(51) })).toContain('approvalIds');
  });

  it('rejects duplicate, empty and non-string ids', async () => {
    expect(await bulk({ action: 'approve', approvalIds: ['a', 'a'] })).toContain('approvalIds');
    expect(await bulk({ action: 'approve', approvalIds: [''] })).toContain('approvalIds');
    expect(await bulk({ action: 'approve', approvalIds: [1] })).toContain('approvalIds');
    expect(await bulk({ action: 'approve' })).toContain('approvalIds');
  });

  it('rejects a note over 500 characters', async () => {
    expect(await bulk({ action: 'reject', approvalIds: ['a'], note: 'x'.repeat(501) })).toContain('note');
  });

  it('rejects an unknown action', async () => {
    expect(await bulk({ action: 'delete', approvalIds: ['a'] })).toContain('action');
    expect(await bulk({ approvalIds: ['a'] })).toContain('action');
  });
});

describe('RetryFailedDto', () => {
  it('accepts empty and boolean bodies', async () => {
    expect(await retry({})).toEqual([]);
    expect(await retry({ includeUnknownOutcome: true })).toEqual([]);
  });
  it('rejects a non-boolean', async () => {
    expect(await retry({ includeUnknownOutcome: 'yes' })).toContain('includeUnknownOutcome');
    expect(await retry({ includeUnknownOutcome: 1 })).toContain('includeUnknownOutcome');
  });
});
