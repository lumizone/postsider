import {
  assertCanApprove,
  assertPending,
  assertRequestable,
} from './approval.rules';

describe('assertRequestable', () => {
  it('throws when the post does not exist', () => {
    expect(() => assertRequestable(null)).toThrow();
  });
  it('throws when the post is not a DRAFT', () => {
    expect(() => assertRequestable({ state: 'QUEUE', parentPostId: null })).toThrow();
  });
  it('throws for a child (thread) post', () => {
    expect(() => assertRequestable({ state: 'DRAFT', parentPostId: 'x' })).toThrow();
  });
  it('passes for a top-level DRAFT', () => {
    expect(() => assertRequestable({ state: 'DRAFT', parentPostId: null })).not.toThrow();
  });
});

describe('assertCanApprove', () => {
  it('forbids a regular USER', () => {
    expect(() => assertCanApprove('USER')).toThrow();
  });
  it('allows ADMIN and SUPERADMIN', () => {
    expect(() => assertCanApprove('ADMIN')).not.toThrow();
    expect(() => assertCanApprove('SUPERADMIN')).not.toThrow();
  });
});

describe('assertPending', () => {
  it('throws when the approval is missing', () => {
    expect(() => assertPending(null)).toThrow();
  });
  it('throws when already resolved', () => {
    expect(() => assertPending({ status: 'APPROVED' })).toThrow();
  });
  it('passes when still pending', () => {
    expect(() => assertPending({ status: 'PENDING' })).not.toThrow();
  });
});
