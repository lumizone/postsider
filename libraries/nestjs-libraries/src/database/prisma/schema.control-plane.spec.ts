import { Prisma, PublishErrorCategory, PublicWebhookDeliveryStatus } from '@prisma/client';

const model = (name: string) =>
  Prisma.dmmf.datamodel.models.find((m) => m.name === name)!;

describe('control plane schema', () => {
  it('PublishErrorCategory has exactly the taxonomy', () => {
    expect(Object.values(PublishErrorCategory).sort()).toEqual(
      ['AUTH_EXPIRED','INVALID_CONTENT','PERMISSION_MISSING','PROVIDER_UNAVAILABLE','RATE_LIMITED','UNKNOWN','UNKNOWN_OUTCOME'].sort()
    );
  });
  it('PublicWebhookDeliveryStatus has PENDING, SUCCEEDED, FAILED', () => {
    expect(Object.values(PublicWebhookDeliveryStatus).sort()).toEqual(['FAILED','PENDING','SUCCEEDED']);
  });
  it('Post has the new failure fields with the right shape', () => {
    const f = (n: string) => model('Post').fields.find((x) => x.name === n)!;
    expect(f('errorCategory')).toMatchObject({ type: 'PublishErrorCategory', isRequired: false });
    expect(f('errorRetryable')).toMatchObject({ type: 'Boolean', isRequired: false });
    expect(f('publishAttempts')).toMatchObject({ type: 'Int', isRequired: true, hasDefaultValue: true });
    expect(f('lastPublishAttemptAt')).toMatchObject({ type: 'DateTime', isRequired: false });
  });
  it('PublicWebhookDelivery has the outbox columns', () => {
    const names = model('PublicWebhookDelivery').fields.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining([
      'id','organizationId','subscriptionId','eventId','event','payload','status',
      'attempts','nextAttemptAt','lastStatusCode','lastError','createdAt','deliveredAt',
    ]));
  });
});
