'use strict';

const GENERIC_REFUSAL =
  'PostSider refused the request. Check that the API key exists and has the scope this step needs.';

// Global afterResponse hook. A request that opted into handling its own status
// (skipThrowForStatus) keeps the raw response, so a step such as decide_approval
// can show the API's specific refusal (self_approval_blocked,
// not_allowed_for_stage, key_action_not_allowed, ...). Every other request keeps
// the generic hint.
const refuseOnAuthStatus = (response) => {
  const own = response && response.request && response.request.skipThrowForStatus;
  if (!own && (response.status === 401 || response.status === 403)) {
    throw new Error(GENERIC_REFUSAL);
  }
  return response;
};

// The message a step shows for a 401/403 it handles itself: the API's error
// code and text when present, else the generic hint.
const refusalMessage = (response) => {
  const data = response && response.data;
  const code = data && typeof data.error === 'string' ? data.error : null;
  const msg = data && typeof data.msg === 'string' ? data.msg : null;
  if (code && msg) return `${code}: ${msg}`;
  if (code || msg) return code || msg;
  return GENERIC_REFUSAL;
};

module.exports = { GENERIC_REFUSAL, refuseOnAuthStatus, refusalMessage };
