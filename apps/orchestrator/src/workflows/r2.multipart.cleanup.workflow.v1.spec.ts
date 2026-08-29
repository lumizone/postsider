const mockCleanupIncompleteR2MultipartUploads = jest.fn();
const mockSleep = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    cleanupIncompleteR2MultipartUploads:
      mockCleanupIncompleteR2MultipartUploads,
  })),
  sleep: mockSleep,
  continueAsNew: jest.fn(),
  log: { error: jest.fn() },
}));

import { r2MultipartCleanupWorkflowV1 } from './r2.multipart.cleanup.workflow.v1';

describe('r2MultipartCleanupWorkflowV1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('runs the isolated cleanup activity once per day', async () => {
    mockCleanupIncompleteR2MultipartUploads.mockResolvedValue({
      scanned: 0,
      aborted: 0,
      skipped: 0,
    });
    mockSleep.mockRejectedValueOnce(new Error('stop after first iteration'));

    await expect(r2MultipartCleanupWorkflowV1()).rejects.toThrow(
      'stop after first iteration'
    );

    expect(mockCleanupIncompleteR2MultipartUploads).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith('1 day');
  });
});
