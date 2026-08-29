import { pricing } from './pricing';

describe('AI plan usage limits', () => {
  it('assigns the agreed cloud AI action quota to each customer plan', () => {
    expect(pricing.FREE.ai_uses_per_month).toBe(0);
    expect(pricing.STANDARD.ai_uses_per_month).toBe(50);
    expect(pricing.TEAM.ai_uses_per_month).toBe(150);
    expect(pricing.PRO.ai_uses_per_month).toBe(500);
    expect(pricing.ULTIMATE.ai_uses_per_month).toBe(1000);
  });

  it('keeps the internal SAMURAI plan unlimited', () => {
    expect(pricing.SAMURAI.ai_uses_per_month).toBeNull();
  });

  it('enables public API and tiered webhooks only on paid plans', () => {
    expect(pricing.FREE.public_api).toBe(false);
    expect(pricing.FREE.webhooks).toBe(0);
    expect(pricing.STANDARD.public_api).toBe(true);
    expect(pricing.STANDARD.webhooks).toBe(2);
    expect(pricing.TEAM.webhooks).toBe(10);
    expect(pricing.PRO.webhooks).toBe(30);
    expect(pricing.ULTIMATE.webhooks).toBe(10000);
  });
});
