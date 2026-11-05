const mockPurge = jest.fn();
const mockSleep = jest.fn();
const mockContinueAsNew = jest.fn();
const mockLogError = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    purgeExpiredPublicApiRecords: mockPurge,
  })),
  sleep: mockSleep,
  continueAsNew: mockContinueAsNew,
  log: { error: mockLogError },
}));

import { publicApiRetentionWorkflow } from './public.api.retention.workflow';

describe('publicApiRetentionWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('purges once then sleeps 24 hours', async () => {
    mockPurge.mockResolvedValue({ deliveries: 0, idempotency: 0 });
    mockSleep.mockRejectedValueOnce(new Error('stop'));

    await expect(publicApiRetentionWorkflow()).rejects.toThrow('stop');

    expect(mockPurge).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith('24 hours');
  });

  it('logs an activity failure and keeps looping', async () => {
    mockPurge.mockRejectedValue(new Error('db down'));
    mockSleep
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stop'));

    await expect(publicApiRetentionWorkflow()).rejects.toThrow('stop');

    expect(mockLogError).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(2);
  });

  it('continues as new after 60 iterations', async () => {
    mockPurge.mockResolvedValue({ deliveries: 0, idempotency: 0 });
    mockSleep.mockResolvedValue(undefined);

    await publicApiRetentionWorkflow();

    expect(mockSleep).toHaveBeenCalledTimes(60);
    expect(mockContinueAsNew).toHaveBeenCalledTimes(1);
  });
});
