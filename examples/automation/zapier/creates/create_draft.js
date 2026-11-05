'use strict';

// Required scope: posts:write. Creates a draft only; nothing is scheduled.
const perform = async (z, bundle) => {
  const { integrationId, content } = bundle.inputData;
  const response = await z.request({
    method: 'POST',
    url: '/public/v1/posts',
    body: {
      type: 'draft',
      shortLink: false,
      date: new Date().toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: integrationId },
          value: [{ content, image: [] }],
          settings: {},
        },
      ],
    },
  });
  return Array.isArray(response.data) ? { results: response.data } : response.data;
};

module.exports = {
  key: 'create_draft',
  noun: 'Post',
  display: {
    label: 'Create Draft Post',
    description: 'Creates a draft post on one channel. Combine with Request Approval to start a review.',
  },
  operation: {
    inputFields: [
      {
        key: 'integrationId',
        label: 'Channel ID',
        type: 'string',
        required: true,
        helpText: 'The PostSider channel (integration) ID, from GET /public/v1/integrations.',
      },
      { key: 'content', label: 'Content', type: 'text', required: true },
    ],
    perform,
    sample: { postId: 'post_example', integration: 'integration_example' },
  },
};
