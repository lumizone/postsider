import { BadRequestException } from '@nestjs/common';
import { WebhooksRepository } from './webhooks.repository';

describe('WebhooksRepository write semantics', () => {
  const body = {
    id: 'webhook-1',
    name: 'Webhook',
    url: 'https://example.com/hook',
    integrations: [],
  };

  it('does not create a webhook from an update payload with an unknown id', async () => {
    const tx = {
      webhooks: {
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const prisma = {
      webhooks: { findFirst: jest.fn().mockResolvedValue(null) },
      integration: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const repository = new WebhooksRepository(prisma as any);

    await expect(repository.createWebhook('org-1', body as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(repository.updateWebhook('org-1', body as any)).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.webhooks.create).not.toHaveBeenCalled();
    expect(tx.webhooks.update).not.toHaveBeenCalled();
  });
});
