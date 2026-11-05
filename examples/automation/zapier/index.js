'use strict';

const authentication = require('./authentication');
const approvalRequested = require('./triggers/approval_requested');
const approvalDecided = require('./triggers/approval_decided');
const requestApproval = require('./creates/request_approval');
const decideApproval = require('./creates/decide_approval');
const createDraft = require('./creates/create_draft');
const { refuseOnAuthStatus } = require('./lib/after');

const baseUrl = (bundle) =>
  String(
    (bundle.authData && bundle.authData.baseUrl) || authentication.DEFAULT_BASE_URL
  ).replace(/\/+$/, '');

// Rewrite the relative request paths used by triggers and creates onto the
// configured base URL, and attach the Authorization header.
const beforeRequest = [
  (request, z, bundle) => {
    if (request.url && request.url.startsWith('/')) {
      request.url = baseUrl(bundle) + request.url;
    }
    return authentication.addAuthHeader(request, z, bundle);
  },
];

const afterResponse = [refuseOnAuthStatus];

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication: {
    type: authentication.type,
    fields: authentication.fields,
    test: authentication.test,
    connectionLabel: authentication.connectionLabel,
  },
  beforeRequest,
  afterResponse,
  triggers: {
    [approvalRequested.key]: approvalRequested,
    [approvalDecided.key]: approvalDecided,
  },
  creates: {
    [requestApproval.key]: requestApproval,
    [decideApproval.key]: decideApproval,
    [createDraft.key]: createDraft,
  },
};
