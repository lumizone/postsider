jest.mock('isomorphic-dompurify', () => ({ sanitize: (v: string) => v }));

import { PublicWorkspaceController } from './public.workspace.controller';
import { ChannelCapacityExceededError } from '@postsider/nestjs-libraries/database/prisma/integrations/integration.repository';
import { NoCheckerConfigError } from '@postsider/nestjs-libraries/post-checker/post-checker.service';
import { AiQuotaExceededError } from '@postsider/nestjs-libraries/database/prisma/subscriptions/subscription.service';

const orgWith = (role: string | undefined) =>
  ({ id: 'org-1', defaultTimezone: 'Europe/Warsaw', users: role ? [{ role }] : [] }) as any;

describe('PublicWorkspaceController', () => {
  const channel = {
    id: 'c1',
    deletedAt: null,
    providerIdentifier: 'x',
    postingTimes: JSON.stringify([{ time: 540 }]),
    timezone: null,
    token: 'SECRET',
  };

  const build = (over: Record<string, any> = {}) => {
    const c = Object.create(PublicWorkspaceController.prototype) as any;
    c._integrationService = {
      getIntegrationById: jest.fn().mockResolvedValue(channel),
      disableChannel: jest.fn().mockResolvedValue(channel),
      enableChannel: jest.fn().mockResolvedValue(channel),
      setTimes: jest.fn().mockResolvedValue(channel),
      updateOnCustomerName: jest.fn().mockResolvedValue(channel),
      ...over.integration,
    };
    c._postsService = {
      getPost: jest.fn().mockResolvedValue({ group: 'g1' }),
      duplicatePost: jest.fn().mockResolvedValue({ duplicated: true }),
    };
    c._mediaService = {
      getMediaById: jest.fn().mockResolvedValue({ id: 'm1' }),
      deleteMedia: jest.fn().mockResolvedValue(undefined),
      ...over.media,
    };
    c._composerHelpers = {
      createHashtagGroup: jest.fn().mockResolvedValue({ id: 'h1' }),
      deleteUtmPreset: jest.fn().mockResolvedValue({}),
    };
    c._smartSlots = { suggest: jest.fn().mockResolvedValue([{ datetime: 'x', score: 1 }]) };
    c._postChecker = { check: jest.fn(), rewrite: jest.fn(), ...over.checker };
    c._permissionsService = {
      getPackageOptions: jest.fn().mockResolvedValue({ subscription: { totalChannels: 3 } }),
    };
    return c as PublicWorkspaceController & Record<string, any>;
  };

  describe('role gating', () => {
    it.each(['USER', undefined])('refuses channel changes for role %s', async (role) => {
      const c = build();
      await expect(c.disableChannel(orgWith(role), 'c1')).rejects.toMatchObject({ status: 403 });
      await expect(c.setQueuePlan(orgWith(role), 'c1', { time: [] } as any)).rejects.toMatchObject({ status: 403 });
      await expect(c.setChannelCustomer(orgWith(role), 'c1', { name: 'A' })).rejects.toMatchObject({ status: 403 });
      expect(c._integrationService.disableChannel).not.toHaveBeenCalled();
    });

    it('lets ADMIN and SUPERADMIN through', async () => {
      for (const role of ['ADMIN', 'SUPERADMIN']) {
        const c = build();
        await expect(c.disableChannel(orgWith(role), 'c1')).resolves.toEqual({ id: 'c1', disabled: true });
      }
    });
  });

  it('404s for a channel that is not the caller\'s', async () => {
    const c = build({ integration: { getIntegrationById: jest.fn().mockResolvedValue(null) } });
    await expect(c.disableChannel(orgWith('ADMIN'), 'nope')).rejects.toMatchObject({ status: 404 });
    await expect(c.getQueuePlan(orgWith('ADMIN'), 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('never returns the channel row (it carries OAuth tokens)', async () => {
    const c = build();
    const res = await c.setChannelCustomer(orgWith('ADMIN'), 'c1', { name: ' Acme ' });
    expect(res).toEqual({ id: 'c1', customer: 'Acme' });
    expect(JSON.stringify(await c.enableChannel(orgWith('ADMIN'), 'c1'))).not.toContain('SECRET');
    expect(c._integrationService.updateOnCustomerName).toHaveBeenCalledWith('org-1', 'c1', 'Acme');
  });

  it('turns a full plan into a payment-required error on enable', async () => {
    const c = build({
      integration: { enableChannel: jest.fn().mockRejectedValue(new ChannelCapacityExceededError()) },
    });
    process.env.POLAR_ACCESS_TOKEN = 'x';
    try {
      await expect(c.enableChannel(orgWith('ADMIN'), 'c1')).rejects.toBeDefined();
      expect(c._permissionsService.getPackageOptions).toHaveBeenCalled();
    } finally {
      delete process.env.POLAR_ACCESS_TOKEN;
    }
  });

  it('reads the queue plan with the org timezone as fallback', async () => {
    const res = await build().getQueuePlan(orgWith('USER'), 'c1');
    expect(res).toEqual({ slots: [{ time: 540 }], timezone: 'Europe/Warsaw' });
  });

  it('validates smart-slot count and uses the channel platform', async () => {
    const c = build();
    await expect(c.smartSlots(orgWith('USER'), 'c1', '99')).rejects.toMatchObject({ status: 400 });
    await c.smartSlots(orgWith('USER'), 'c1', '4');
    expect(c._smartSlots.suggest).toHaveBeenCalledWith('org-1', 'c1', 'x', 4);
  });

  describe('library', () => {
    it('rejects an unknown kind', async () => {
      await expect(build().createLibraryItem(orgWith('USER'), 'nope', {})).rejects.toMatchObject({ status: 400 });
    });

    it('validates the body like the dashboard DTO', async () => {
      const c = build();
      await expect(
        c.createLibraryItem(orgWith('USER'), 'hashtag-groups', { name: '', hashtags: 'x' })
      ).rejects.toMatchObject({ status: 400 });
      expect(c._composerHelpers.createHashtagGroup).not.toHaveBeenCalled();

      await c.createLibraryItem(orgWith('USER'), 'hashtag-groups', { name: 'L', hashtags: ['#a'] });
      expect(c._composerHelpers.createHashtagGroup).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ name: 'L', hashtags: ['#a'] })
      );
    });

    it('routes deletes by kind', async () => {
      const c = build();
      await c.deleteLibraryItem(orgWith('USER'), 'utm-presets', 'u1');
      expect(c._composerHelpers.deleteUtmPreset).toHaveBeenCalledWith('org-1', 'u1');
    });
  });

  it('duplicates by resolving the post group first', async () => {
    const c = build();
    await c.duplicatePost(orgWith('USER'), 'p1', { channelId: 'c2' });
    expect(c._postsService.duplicatePost).toHaveBeenCalledWith('org-1', 'g1', 'c2', undefined);
  });

  describe('AI errors', () => {
    it('maps missing config to 409 and exhausted quota to 402', async () => {
      const dto = { content: 'hi', hasMedia: false, platforms: ['x'] } as any;
      const noKey = build({ checker: { check: jest.fn().mockRejectedValue(new NoCheckerConfigError()) } });
      await expect(noKey.checkPost(orgWith('USER'), dto)).rejects.toMatchObject({ status: 409 });

      const quota = build({ checker: { rewrite: jest.fn().mockRejectedValue(new AiQuotaExceededError()) } });
      await expect(quota.rewritePost(orgWith('USER'), { content: 'hi' } as any)).rejects.toMatchObject({ status: 402 });
    });
  });

  it('only deletes media the org owns', async () => {
    const missing = build({ media: { getMediaById: jest.fn().mockResolvedValue(null) } });
    await expect(missing.deleteMedia(orgWith('USER'), 'm1')).rejects.toMatchObject({ status: 404 });
    expect(missing._mediaService.deleteMedia).not.toHaveBeenCalled();

    const ok = build();
    await expect(ok.deleteMedia(orgWith('USER'), 'm1')).resolves.toEqual({ deleted: true, id: 'm1' });
  });
});
