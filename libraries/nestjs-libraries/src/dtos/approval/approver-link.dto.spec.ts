import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ApproverLinkDecisionDto } from './approver-link.dto';

const check = (body: unknown) =>
  validateSync(plainToInstance(ApproverLinkDecisionDto, body as object)).map(
    (e) => e.property
  );

describe('ApproverLinkDecisionDto', () => {
  it('accepts approve and reject with a challenge', () => {
    expect(check({ decision: 'approve', challenge: 'x' })).toEqual([]);
    expect(check({ decision: 'reject', challenge: 'x', note: 'no' })).toEqual([]);
  });

  it('rejects an unknown decision', () => {
    expect(check({ decision: 'maybe', challenge: 'x' })).toEqual(['decision']);
    expect(check({ challenge: 'x' })).toEqual(['decision']);
  });

  it('requires a challenge of 1 to 200 characters', () => {
    expect(check({ decision: 'approve' })).toContain('challenge');
    expect(check({ decision: 'approve', challenge: '' })).toContain('challenge');
    expect(check({ decision: 'approve', challenge: 'a'.repeat(201) })).toContain('challenge');
    expect(check({ decision: 'approve', challenge: 'a'.repeat(200) })).toEqual([]);
  });

  it('limits the note to 500 characters and requires a string', () => {
    expect(check({ decision: 'reject', challenge: 'x', note: 'n'.repeat(501) })).toEqual(['note']);
    expect(check({ decision: 'reject', challenge: 'x', note: 'n'.repeat(500) })).toEqual([]);
    expect(check({ decision: 'reject', challenge: 'x', note: 5 })).toEqual(['note']);
  });
});
