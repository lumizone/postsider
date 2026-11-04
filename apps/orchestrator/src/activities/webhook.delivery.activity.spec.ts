import { WebhookDeliveryActivity } from './webhook.delivery.activity';

describe('WebhookDeliveryActivity', () => {
  it('delegates to processDue with no arguments and returns its result', async () => {
    const result = { claimed: 4, succeeded: 3, retried: 1, failed: 0 };
    const delivery = { processDue: jest.fn().mockResolvedValue(result) };
    const activity = new WebhookDeliveryActivity(delivery as never);

    await expect(activity.processDueWebhookDeliveries()).resolves.toEqual(
      result
    );
    expect(delivery.processDue).toHaveBeenCalledTimes(1);
    expect(delivery.processDue).toHaveBeenCalledWith();
  });
});
