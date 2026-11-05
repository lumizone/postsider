'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { refuseOnAuthStatus, refusalMessage, GENERIC_REFUSAL } = require('../lib/after');
const decideApproval = require('../creates/decide_approval');

test('a plain 401/403 keeps the generic hint', () => {
  for (const status of [401, 403]) {
    assert.throws(() => refuseOnAuthStatus({ status, request: {} }), { message: GENERIC_REFUSAL });
    assert.throws(() => refuseOnAuthStatus({ status }), { message: GENERIC_REFUSAL });
  }
});

test('a request with skipThrowForStatus passes through, and other statuses are untouched', () => {
  const refused = { status: 403, request: { skipThrowForStatus: true }, data: { error: 'self_approval_blocked' } };
  assert.equal(refuseOnAuthStatus(refused), refused);
  const ok = { status: 200, request: {} };
  assert.equal(refuseOnAuthStatus(ok), ok);
});

test('refusalMessage shows the API code and text, falling back to the generic hint', () => {
  assert.equal(
    refusalMessage({ data: { error: 'self_approval_blocked', msg: 'You created this post.' } }),
    'self_approval_blocked: You created this post.'
  );
  assert.equal(refusalMessage({ data: { error: 'not_allowed_for_stage' } }), 'not_allowed_for_stage');
  assert.equal(refusalMessage({ data: {} }), GENERIC_REFUSAL);
  assert.equal(refusalMessage({}), GENERIC_REFUSAL);
});

test('decide_approval surfaces the API refusal code instead of the generic hint', async () => {
  const calls = [];
  const z = {
    errors: {
      Error: class extends Error {
        constructor(message, code, status) {
          super(message);
          this.code = code;
          this.status = status;
        }
      },
    },
    request: async (opts) => {
      calls.push(opts);
      if (opts.method === 'GET') return { status: 404, data: {} };
      return {
        status: 403,
        data: { error: 'self_approval_blocked', msg: 'A key cannot approve its own post.' },
        throwForStatus() {
          throw new Error('should not be reached');
        },
      };
    },
  };
  await assert.rejects(
    decideApproval.operation.perform(z, { inputData: { approvalId: 'a1', decision: 'approve' }, meta: {} }),
    (e) => e.code === 'self_approval_blocked' && e.status === 403 && /self_approval_blocked/.test(e.message)
  );
  assert.equal(calls[calls.length - 1].skipThrowForStatus, true);
});
