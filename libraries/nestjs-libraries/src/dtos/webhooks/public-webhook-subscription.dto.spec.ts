import { validate } from 'class-validator';
import { CreatePublicWebhookSubscriptionDto } from './public-webhook-subscription.dto';

describe('public webhook subscription URL validation', () => {
  const dto = (url: string) => Object.assign(
    new CreatePublicWebhookSubscriptionDto(),
    { name: 'Test hook', events: ['post.published'], url }
  );

  it.each([
    'http://hooks.example.com/post',
    'https://127.0.0.1/internal',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/post',
    'https://[::1]/internal',
  ])('rejects unsafe webhook destination %s', async (url) => {
    const errors = await validate(dto(url));
    expect(errors.some((entry) => entry.property === 'url')).toBe(true);
  });
});
