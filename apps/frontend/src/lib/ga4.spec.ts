/**
 * GA4 + funnel milestone mapping. Runs in the node env with a tiny fake
 * browser (window, document, storage) so no jsdom environment package is needed.
 */
const ID = 'G-TEST123456';

jest.mock('@/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

type Fake = {
  cookie: string;
  scripts: string[];
  local: Map<string, string>;
  session: Map<string, string>;
  attrs: Record<string, Record<string, string>>;
};

function setupBrowser(opts: { consent: boolean; host?: string; cookies?: string }): Fake {
  const state: Fake = {
    cookie: opts.cookies ?? (opts.consent ? 'ps_analytics_consent=1' : ''),
    scripts: [],
    local: new Map(),
    session: new Map(),
    attrs: {},
  };
  const storage = (m: Map<string, string>) => ({
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  });
  const head = {
    appendChild: (el: { src: string; attrs?: Record<string, string> }) => {
      state.scripts.push(el.src);
      state.attrs[el.src] = el.attrs || {};
    },
  };
  const doc: any = {
    head,
    title: 'T',
    createElement: () => {
      const attrs: Record<string, string> = {};
      return { attrs, setAttribute: (k: string, v: string) => void (attrs[k] = v) };
    },
    querySelector: (sel: string) =>
      state.scripts.some((s) => sel.includes(s)) ? {} : null,
  };
  Object.defineProperty(doc, 'cookie', {
    get: () => state.cookie,
    set: (v: string) => {
      state.cookie = state.cookie ? state.cookie + '; ' + v.split(';')[0] : v.split(';')[0];
    },
  });
  (global as any).document = doc;
  (global as any).window = {
    location: {
      hostname: opts.host || 'app.postsider.com',
      origin: 'https://' + (opts.host || 'app.postsider.com'),
      protocol: 'https:',
    },
    dataLayer: undefined,
    gtag: undefined,
    umami: undefined,
  };
  (global as any).localStorage = storage(state.local);
  (global as any).sessionStorage = storage(state.session);
  (global as any).crypto = { randomUUID: () => '11111111-2222-3333-4444-555555555555' };
  return state;
}

function load() {
  let mod: any;
  jest.isolateModules(() => {
    mod = {
      ga: require('@/lib/ga4'),
      funnel: require('@/lib/funnel-analytics'),
      api: require('@/lib/api').api,
    };
  });
  return mod;
}

const gtagCalls = () =>
  ((global as any).window.dataLayer || []).map((a: ArrayLike<unknown>) => Array.from(a));
const events = () => gtagCalls().filter((c: unknown[]) => c[0] === 'event');

afterEach(() => {
  delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  delete process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
  delete (global as any).window;
  delete (global as any).document;
});

describe('GA4 gating and hosted defaults', () => {
  it.each([undefined, '', 'UA-123', 'G-', 'g-abc123456', 'G-ABC 123456'])(
    'is off on a fork host for env %p',
    (value) => {
      if (value !== undefined) process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = value;
      const b = setupBrowser({ consent: true, host: 'fork.example.com' });
      const { ga, funnel } = load();
      expect(ga.gaMeasurementId()).toBe('');
      expect(ga.gaEnabled()).toBe(false);
      expect(ga.ensureGa()).toBe(false);
      expect(ga.gaEvent('x')).toBe(false);
      expect(ga.gaPageView('/a')).toBe(false);
      expect(ga.trackLogin('email')).toBe(false);
      funnel.ensureFunnelAnalytics();
      expect(b.scripts).toEqual([]);
      expect((global as any).window.dataLayer).toBeUndefined();
    },
  );

  it('defaults to the hosted ids only on app.postsider.com', () => {
    setupBrowser({ consent: false, host: 'app.postsider.com' });
    let { ga } = load();
    expect(ga.gaMeasurementId()).toBe('G-72MBFGEQRR');
    expect(ga.googleAdsId()).toBe('AW-18533590201');
    setupBrowser({ consent: false, host: 'docs.postsider.com' });
    ({ ga } = load());
    expect(ga.gaMeasurementId()).toBe('');
    expect(ga.googleAdsId()).toBe('');
  });

  it('prefers a valid env value over the hosted default and ignores a bad ads id', () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = 'AW-bad';
    setupBrowser({ consent: false, host: 'fork.example.com' });
    const { ga } = load();
    expect(ga.gaMeasurementId()).toBe(ID);
    expect(ga.googleAdsId()).toBe('');
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = 'AW-123456789';
    expect(load().ga.googleAdsId()).toBe('AW-123456789');
  });

  it('does not break SSR (no window)', () => {
    const { ga } = load();
    expect(ga.gaMeasurementId()).toBe('');
    expect(ga.ensureGa()).toBe(false);
  });

  it('loads gtag for a visitor without consent, with denied defaults before config', () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = 'AW-123456789';
    const b = setupBrowser({ consent: false });
    const { ga } = load();
    expect(ga.ensureGa()).toBe(true);
    expect(ga.ensureGa()).toBe(true);
    expect(b.scripts).toEqual(['https://www.googletagmanager.com/gtag/js?id=' + ID]);
    const calls = gtagCalls();
    const names = calls.map((c: unknown[]) => c[0] + ':' + c[1]);
    expect(names.indexOf('consent:default')).toBeLessThan(names.indexOf('config:' + ID));
    expect(calls.find((c: unknown[]) => c[1] === 'default')[2]).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500,
    });
    const config = calls.find((c: unknown[]) => c[0] === 'config' && c[1] === ID)[2];
    expect(config).toEqual({ send_page_view: false, cookie_domain: '.postsider.com' });
    expect(calls.some((c: unknown[]) => c[0] === 'config' && c[1] === 'AW-123456789')).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/user_id|email|org|allow_google_signals/i);
  });

  it('maps consent cookies to consent states', () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    setupBrowser({ consent: false, cookies: 'ps_analytics_consent=1' });
    const { ga } = load();
    ga.ensureGa();
    expect(gtagCalls().find((c: unknown[]) => c[1] === 'default')[2]).toMatchObject({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    });

    setupBrowser({ consent: false, cookies: 'ps_analytics_consent=1; ps_marketing_consent=1' });
    const m = load().ga;
    m.ensureGa();
    expect(gtagCalls().find((c: unknown[]) => c[1] === 'default')[2]).toMatchObject({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('updateGaConsent pushes the current cookie choice', () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    const b = setupBrowser({ consent: false });
    const { ga } = load();
    ga.ensureGa();
    b.cookie = 'ps_analytics_consent=1; ps_marketing_consent=1';
    expect(ga.updateGaConsent()).toBe(true);
    const update = gtagCalls().find((c: unknown[]) => c[1] === 'update')[2];
    expect(update).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    });
  });

  it('uses auto cookie domain off postsider.com', () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    setupBrowser({ consent: true, host: 'localhost' });
    const { ga } = load();
    ga.ensureGa();
    const config = gtagCalls().find((c: unknown[]) => c[0] === 'config')[2];
    expect(config.cookie_domain).toBe('auto');
  });

  it('sends page_view without consent, path only, skipping an identical consecutive path', () => {
    setupBrowser({ consent: false });
    const { ga } = load();
    expect(ga.gaPageView('/calendar')).toBe(true);
    expect(ga.gaPageView('/calendar')).toBe(false);
    expect(ga.gaPageView('/agents')).toBe(true);
    const pv = events().filter((e: unknown[]) => e[1] === 'page_view');
    expect(pv).toHaveLength(2);
    expect(pv[0][2].page_location).toBe('https://app.postsider.com/calendar');
  });
});

describe('Umami loading', () => {
  it('loads for everyone on postsider hosts with auto-track and a before-send hook', () => {
    const b = setupBrowser({ consent: false });
    const { funnel } = load();
    funnel.ensureFunnelAnalytics();
    const umamiSrc = 'https://analytics.darkdynasty.cloud/script.js';
    expect(b.scripts).toContain(umamiSrc);
    expect(b.attrs[umamiSrc]).toMatchObject({
      'data-auto-track': 'true',
      'data-exclude-search': 'true',
      'data-exclude-hash': 'true',
      'data-before-send': 'psUmamiBeforeSend',
    });
    const hook = (global as any).window.psUmamiBeforeSend;
    expect(hook('event', { url: '/a?token=1#x', referrer: 'https://x.test/p?q=1' })).toEqual({
      url: '/a',
      referrer: 'https://x.test/p',
    });
    // No journey cookie without consent.
    expect(b.cookie).not.toMatch(/ps_journey_id/);
  });

  it('never loads on a fork host', () => {
    const b = setupBrowser({ consent: true, host: 'fork.example.com' });
    load().funnel.ensureFunnelAnalytics();
    expect(b.scripts).toEqual([]);
  });

  it('queues umamiEvent (bounded) until window.umami exists', () => {
    setupBrowser({ consent: false });
    const { ga } = load();
    for (let i = 0; i < 25; i++) ga.umamiEvent('e' + i);
    const track = jest.fn();
    (global as any).window.umami = { track };
    ga.flushUmamiQueue();
    expect(track).toHaveBeenCalledTimes(20);
    expect(track.mock.calls[0][0]).toBe('e5');
  });
});

describe('sign_up event', () => {
  it('fires once per tab for everyone, without consent', () => {
    setupBrowser({ consent: false });
    const track = jest.fn();
    (global as any).window.umami = { track };
    const { ga } = load();
    expect(ga.trackSignUp('email')).toBe(true);
    expect(ga.trackSignUp('google')).toBe(false);
    const su = events().filter((e: unknown[]) => e[1] === 'sign_up');
    expect(su.map((e: unknown[]) => e[2])).toEqual([{ method: 'email' }]);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('sign_up', { method: 'email' });
  });
});

describe('login event guard', () => {
  it('sends login once per session and again after reset', () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    setupBrowser({ consent: true });
    const { ga } = load();
    expect(ga.trackLogin('email')).toBe(true);
    expect(ga.trackLogin('email')).toBe(false);
    ga.resetLoginGuard();
    expect(ga.trackLogin('google')).toBe(true);
    const logins = events().filter((e: unknown[]) => e[1] === 'login');
    expect(logins.map((e: unknown[]) => e[2])).toEqual([{ method: 'email' }, { method: 'google' }]);
  });

  it('uses the remembered method after an MFA hop and rejects odd values', () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    setupBrowser({ consent: true });
    const { ga } = load();
    ga.rememberLoginMethod('google');
    expect(ga.trackLogin()).toBe(true);
    ga.resetLoginGuard();
    expect(ga.trackLogin('a@b.com')).toBe(true);
    const logins = events().filter((e: unknown[]) => e[1] === 'login');
    expect(logins[0][2]).toEqual({ method: 'google' });
    expect(logins[1][2]).toEqual({});
  });

  it('fires without consent and also reports to Umami', () => {
    setupBrowser({ consent: false });
    const track = jest.fn();
    (global as any).window.umami = { track };
    const { ga } = load();
    expect(ga.trackLogin('email')).toBe(true);
    expect(track).toHaveBeenCalledWith('login', { method: 'email' });
  });
});

describe('milestone mapping', () => {
  it('maps each milestone to its GA4 event', () => {
    const { funnel } = (process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID, setupBrowser({ consent: true }), load());
    expect(funnel.gaMappingFor('signup_completed', {})).toEqual({ name: 'signup_confirmed', params: {} });
    expect(funnel.gaMappingFor('onboarding_type_selected', { onboarding_type: 'agents' })).toEqual({
      name: 'onboarding_type_selected',
      params: { onboarding_type: 'agents' },
    });
    for (const s of ['mcp_connected', 'first_draft_created', 'subscription_started']) {
      expect(funnel.gaMappingFor(s, { journey_id: 'x' })).toEqual({ name: s, params: {} });
    }
  });

  it('sends every milestone to GA4 exactly once across syncs and reloads', async () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = ID;
    const b = setupBrowser({ consent: true });
    let mod = load();
    const journey = {
      consented: true,
      source: 'google',
      campaign: 'x',
      landingPath: '/',
      onboardingType: 'agents',
      milestones: {
        signup_completed: true,
        onboarding_type_selected: true,
        mcp_connected: true,
        first_draft_created: true,
        subscription_started: true,
      },
    };
    mod.api.get.mockResolvedValue(journey);
    await mod.funnel.syncFunnelMilestones();
    await mod.funnel.syncFunnelMilestones();
    const names = () => events().map((e: unknown[]) => e[1]);
    expect(names()).toEqual([
      'signup_confirmed',
      'onboarding_type_selected',
      'mcp_connected',
      'first_draft_created',
      'subscription_started',
    ]);
    expect(names()).not.toContain('purchase');
    expect(events()[1][2]).toEqual({ onboarding_type: 'agents' });

    // "Reload": fresh module state, same localStorage.
    (global as any).window.dataLayer = undefined;
    (global as any).window.gtag = undefined;
    mod = load();
    mod.api.get.mockResolvedValue(journey);
    await mod.funnel.syncFunnelMilestones();
    expect(events()).toHaveLength(0);
    expect(b.local.size).toBeGreaterThan(0);
  });

  it('keeps Umami behaviour when GA is off (no GA keys, nothing in dataLayer)', async () => {
    const b = setupBrowser({ consent: true, host: 'fork.example.com' });
    const track = jest.fn();
    (global as any).window.umami = { track };
    const mod = load();
    mod.api.get.mockResolvedValue({
      consented: true,
      milestones: { signup_completed: true },
    });
    await mod.funnel.syncFunnelMilestones();
    expect(track).toHaveBeenCalledTimes(1);
    expect((global as any).window.dataLayer).toBeUndefined();
    expect([...b.local.keys()].some((k) => k.endsWith(':ga'))).toBe(false);
  });
});
