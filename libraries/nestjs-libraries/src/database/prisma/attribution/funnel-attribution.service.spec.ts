import {
  FunnelAttributionService,
  parseFirstTouch,
  parseJourneyId,
} from './funnel-attribution.service';

describe('Stage 5 first-party conversion attribution', () => {
  const newOrg = new Date();
  const cookie = {
    ps_analytics_consent: '1',
    ps_attribution_v1: encodeURIComponent(JSON.stringify({
      v: 1,
      landing_path: '/mcp-social-media-server/',
      utm_source: 'reddit',
      utm_medium: 'organic',
      utm_campaign: 'agent-launch',
      referrer_host: 'reddit.com',
    })),
    ps_journey_id: 'a8720d8b-2ccb-42de-94a6-1f98962ce7e4',
  };

  function create() {
    const row = {
      journeyId: cookie.ps_journey_id,
      landingPath: '/mcp-social-media-server/',
      utmSource: 'reddit',
      utmCampaign: 'agent-launch',
      referrerHost: 'reddit.com',
      signupCompletedAt: new Date(),
      onboardingTypeSelectedAt: new Date(),
      onboardingIntent: 'agents',
      mcpConnectedAt: new Date(),
      firstDraftCreatedAt: new Date(),
      subscriptionStartedAt: new Date(),
      firstPaidTier: 'TEAM',
      firstPaidCurrency: 'USD',
      firstPaidAmount: 3500,
    };
    const model = {
      upsert: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([{
        organizationId: 'org1',
        ...row,
      }]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    return { service: new FunnelAttributionService({ funnelAttribution: model } as any), model };
  }

  it('rejects untrusted attribution values instead of collecting secrets', () => {
    expect(parseFirstTouch(encodeURIComponent(JSON.stringify({
      v: 1,
      landing_path: '/path?token=very-secret',
      utm_source: 'reddit?access_token=topsecret',
      utm_campaign: 'launch',
    })))).toMatchObject({
      landingPath: null,
      utmSource: null,
      utmCampaign: 'launch',
    });
    expect(parseJourneyId('token-not-an-id')).toBeNull();
    expect(parseFirstTouch('invalid JSON')).toBeNull();
  });

  it('does not record anything if analytics consent is absent or rejected', async () => {
    const { service, model } = create();
    await expect(service.recordSignupCreated('org1', {}))
      .resolves.toEqual({ recorded: false, consented: false });
    await expect(service.getJourney('org1', { ps_analytics_consent: '0' }))
      .resolves.toEqual({ consented: false, milestones: null });
    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.findUnique).not.toHaveBeenCalled();
  });

  it('records real backend account creation against consented first-touch fields', async () => {
    const { service, model } = create();
    const result = await service.recordSignupCreated('org1', cookie);
    expect(result).toEqual({ recorded: true, consented: true });
    expect(model.upsert).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      create: expect.objectContaining({
        organizationId: 'org1',
        signupCompletedAt: expect.any(Date),
        utmSource: 'reddit',
        utmCampaign: 'agent-launch',
        landingPath: '/mcp-social-media-server/',
        journeyId: cookie.ps_journey_id,
      }),
      update: {},
    });
    expect(model.updateMany).not.toHaveBeenCalled();
  });

  it('never accepts signup completion from the onboarding stage', async () => {
    const { service, model } = create();
    const result = await service.recordClientStage('org1', 'signup_completed' as any, cookie);
    expect(result.recorded).toBe(false);
    expect(model.upsert).not.toHaveBeenCalled();
  });

  it('validates intent choices and records only the first selection', async () => {
    const { service, model } = create();
    const rejected = await service.recordClientStage('org1', null as any, cookie);
    expect(rejected.recorded).toBe(false);
    const accepted = await service.recordClientStage('org1', 'agents', cookie);
    expect(accepted.recorded).toBe(true);
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', onboardingTypeSelectedAt: null },
      data: { onboardingIntent: 'agents', onboardingTypeSelectedAt: expect.any(Date) },
    });
  });

  it('only counts a confirmed positive-amount order once per consenting organization', async () => {
    const { service, model } = create();
    await service.recordFirstPaidOrder('org1', 'TEAM', 0, 'USD');
    expect(model.updateMany).not.toHaveBeenCalled();
    await service.recordFirstPaidOrder('org1', 'TEAM', 3500, 'USD');
    expect(model.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1', subscriptionStartedAt: null },
      data: {
        subscriptionStartedAt: expect.any(Date),
        firstPaidTier: 'TEAM',
        firstPaidAmount: 3500,
        firstPaidCurrency: 'USD',
      },
    });
  });

  it('marks draft and OAuth milestones without generating a new attribution record', async () => {
    const { service, model } = create();
    await service.recordFirstDraft('org1');
    await service.recordMcpConnected('org1');
    expect(model.upsert).not.toHaveBeenCalled();
    expect(model.updateMany).toHaveBeenNthCalledWith(1, {
      where: { organizationId: 'org1', firstDraftCreatedAt: null },
      data: { firstDraftCreatedAt: expect.any(Date) },
    });
    expect(model.updateMany).toHaveBeenNthCalledWith(2, {
      where: { organizationId: 'org1', mcpConnectedAt: null },
      data: { mcpConnectedAt: expect.any(Date) },
    });
  });

  it('produces a purchase/source funnel with no emails, tokens or post content', async () => {
    const { service } = create();
    const report = await service.acquisitionReport(90);
    expect(report.bySourceCampaign).toEqual([
      expect.objectContaining({
        source: 'reddit', campaign: 'agent-launch', signups: 1,
        mcpConnected: 1, firstDrafts: 1, payingCustomers: 1,
      }),
    ]);
    expect(report.paidJourneys).toEqual([
      expect.objectContaining({ source: 'reddit', firstPaidTier: 'TEAM', firstPaidAmount: 3500 }),
    ]);
    const raw = JSON.stringify(report);
    expect(raw).not.toContain('email');
    expect(raw).not.toContain('token');
    expect(raw).not.toContain('content');
  });
});
