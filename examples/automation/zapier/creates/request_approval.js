'use strict';

// Required scope: approvals:write
const perform = async (z, bundle) => {
  const response = await z.request({
    method: 'POST',
    url: `/public/v1/posts/${encodeURIComponent(bundle.inputData.postId)}/request-approval`,
    body: {},
  });
  return response.data && typeof response.data === 'object'
    ? response.data
    : { requested: true };
};

module.exports = {
  key: 'request_approval',
  noun: 'Approval',
  display: {
    label: 'Request Approval',
    description: 'Moves a draft post into approval so reviewers can decide it.',
  },
  operation: {
    inputFields: [
      {
        key: 'postId',
        label: 'Post ID',
        type: 'string',
        required: true,
        helpText: 'The ID of the PostSider post to send for approval.',
      },
    ],
    perform,
    sample: { approvalId: 'approval_example', postId: 'post_example', status: 'PENDING' },
  },
};
