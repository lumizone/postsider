/** Consent cookie writing used by the in-app banner (node env, tiny fake browser). */
function setup(host: string, protocol = 'https:') {
  const writes: string[] = [];
  const dispatched: string[] = [];
  (global as any).document = {
    get cookie() {
      return writes.map((w) => w.split(';')[0]).join('; ');
    },
    set cookie(v: string) {
      writes.push(v);
    },
  };
  (global as any).window = {
    location: { hostname: host, protocol },
    dispatchEvent: (e: { type: string }) => void dispatched.push(e.type),
  };
  (global as any).Event = class { constructor(public type: string) {} };
  return { writes, dispatched };
}

afterEach(() => {
  delete (global as any).window;
  delete (global as any).document;
  delete (global as any).Event;
});

describe('writeConsent', () => {
  it('accept writes both cookies with shared-domain attrs and notifies', () => {
    const { writes, dispatched } = setup('app.postsider.com');
    const c = require('@/lib/analytics-consent');
    expect(c.consentDecided()).toBe(false);
    c.writeConsent(true);
    expect(writes).toEqual([
      'ps_analytics_consent=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure; Domain=.postsider.com',
      'ps_marketing_consent=1; Path=/; Max-Age=31536000; SameSite=Lax; Secure; Domain=.postsider.com',
    ]);
    expect(dispatched).toEqual(['ps:consent']);
    expect(c.analyticsConsent()).toBe(true);
    expect(c.marketingConsent()).toBe(true);
    expect(c.consentDecided()).toBe(true);
  });

  it('reject writes 0 and counts as decided; localhost gets no Domain/Secure', () => {
    const { writes } = setup('localhost', 'http:');
    const c = require('@/lib/analytics-consent');
    c.writeConsent(false);
    expect(writes[0]).toBe('ps_analytics_consent=0; Path=/; Max-Age=31536000; SameSite=Lax');
    expect(c.analyticsConsent()).toBe(false);
    expect(c.consentDecided()).toBe(true);
  });
});
