import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreatePublicWebhookSubscriptionDto,
  UpdatePublicWebhookSubscriptionDto,
} from './public-webhook-subscription.dto';
import { isLocalWebhookHost } from './webhook.url.validator';

const errorsFor = async (cls: any, url: string) => {
  const dto = plainToInstance(cls, {
    name: 'x',
    url,
    events: ['post.published'],
  });
  const errors = await validate(dto as object);
  return errors.filter((e) => e.property === 'url');
};

describe('public webhook subscription URL validation', () => {
  it.each([
    'https://127.0.0.1:9911/hook',
    'https://localhost/hook',
    'https://app.localhost/hook',
    'https://10.1.2.3/hook',
    'https://172.16.0.1/hook',
    'https://192.168.1.1/hook',
    'https://169.254.169.254/latest',
    'https://0.0.0.0/hook',
    'https://[::1]/hook',
    'https://[fc00::1]/hook',
    'https://[fe80::1]/hook',
    'https://[::ffff:127.0.0.1]/hook',
    'https://2130706433/hook',
  ])('rejects %s on create and update', async (url) => {
    expect(await errorsFor(CreatePublicWebhookSubscriptionDto, url)).not.toHaveLength(0);
    expect(await errorsFor(UpdatePublicWebhookSubscriptionDto, url)).not.toHaveLength(0);
    const errors = await errorsFor(CreatePublicWebhookSubscriptionDto, url);
    expect(JSON.stringify(errors)).toContain('IsNotLocalWebhookHost');
  });

  it.each([
    'https://hooks.example.com/postsider',
    'https://8.8.8.8/hook',
    'https://localhost.example.com/hook',
  ])('accepts %s', async (url) => {
    expect(await errorsFor(CreatePublicWebhookSubscriptionDto, url)).toHaveLength(0);
  });

  it('isLocalWebhookHost ignores unparseable input', () => {
    expect(isLocalWebhookHost('not a url')).toBe(false);
    expect(isLocalWebhookHost(undefined)).toBe(false);
  });
});
