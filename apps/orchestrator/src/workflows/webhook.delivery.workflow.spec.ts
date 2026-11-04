const mockProcess = jest.fn();
const mockSleep = jest.fn();
const mockContinueAsNew = jest.fn();
const mockLogError = jest.fn();

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => ({
    processDueWebhookDeliveries: mockProcess,
  })),
  sleep: mockSleep,
  continueAsNew: mockContinueAsNew,
  log: { error: mockLogError },
}));

import { webhookDeliveryWorkflow } from './webhook.delivery.workflow';

const result = (claimed: number) => ({
  claimed,
  succeeded: claimed,
  retried: 0,
  failed: 0,
});

describe('webhookDeliveryWorkflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('processes once then sleeps one minute', async () => {
    mockProcess.mockResolvedValue(result(0));
    mockSleep.mockRejectedValueOnce(new Error('stop'));

    await expect(webhookDeliveryWorkflow()).rejects.toThrow('stop');

    expect(mockProcess).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith('1 minute');
  });

  it('drains full batches before sleeping', async () => {
    mockProcess
      .mockResolvedValueOnce(result(50))
      .mockResolvedValueOnce(result(3));
    mockSleep.mockRejectedValueOnce(new Error('stop'));

    await expect(webhookDeliveryWorkflow()).rejects.toThrow('stop');

    expect(mockProcess).toHaveBeenCalledTimes(2);
  });

  it('logs an activity failure and keeps looping', async () => {
    mockProcess.mockRejectedValue(new Error('db down'));
    mockSleep
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('stop'));

    await expect(webhookDeliveryWorkflow()).rejects.toThrow('stop');

    expect(mockLogError).toHaveBeenCalledTimes(2);
    expect(mockSleep).toHaveBeenCalledTimes(2);
  });

  it('continues as new after 120 iterations', async () => {
    mockProcess.mockResolvedValue(result(0));
    mockSleep.mockResolvedValue(undefined);

    await webhookDeliveryWorkflow();

    expect(mockSleep).toHaveBeenCalledTimes(120);
    expect(mockContinueAsNew).toHaveBeenCalledTimes(1);
  });
});
