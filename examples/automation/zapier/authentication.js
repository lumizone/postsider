'use strict';

const DEFAULT_BASE_URL = 'https://api.postsider.com';

// Same credential shape as the n8n node: the API key goes in the
// Authorization header as is (no "Bearer" prefix).
const addAuthHeader = (request, z, bundle) => {
  request.headers = request.headers || {};
  request.headers.Authorization = bundle.authData.apiKey;
  return request;
};

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
      helpText:
        'Create a key in PostSider under Settings > Public API. Scopes used: approvals:read, approvals:write, approvals:decide, webhooks:write, posts:write.',
    },
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'string',
      required: false,
      default: DEFAULT_BASE_URL,
      helpText: 'Leave as is for PostSider cloud. Change it for a self-hosted install.',
    },
  ],
  test: {
    url: '{{bundle.authData.baseUrl}}/public/v1/is-connected',
    method: 'GET',
  },
  connectionLabel: '{{bundle.authData.baseUrl}}',
  addAuthHeader,
  DEFAULT_BASE_URL,
};
