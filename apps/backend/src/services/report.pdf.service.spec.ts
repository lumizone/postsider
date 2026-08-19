import { ReportPdfService } from './report.pdf.service';

const sample = {
  generatedAt: '2026-08-17T00:00:00.000Z',
  branding: { name: 'Agency Co', logo: null },
  customer: { id: 'c1', name: 'Acme' },
  period: { days: 30, start: '2026-07-18T00:00:00.000Z', end: '2026-08-17T00:00:00.000Z' },
  delivery: {
    channels: 2,
    activeChannels: 1,
    published: 5,
    perChannel: [
      { name: 'Instagram', providerIdentifier: 'instagram', disabled: false, published: 4 },
      { name: 'X', providerIdentifier: 'x', disabled: true, published: 1 },
    ],
  },
  engagement: [
    { metric: 'Reach', total: 1200 },
    { metric: 'Likes', total: 80 },
  ],
  topPosts: [
    { content: '<p>Hello <b>world</b></p>', releaseURL: 'https://x/1', publishedAt: '2026-08-01T00:00:00.000Z', channel: 'Instagram', engagement: 900 },
    { content: 'Second post', releaseURL: null, publishedAt: '2026-08-02T00:00:00.000Z', channel: 'X', engagement: 300 },
  ],
};

describe('ReportPdfService', () => {
  it('produces a valid PDF from report data', async () => {
    const bytes = await new ReportPdfService().generate(sample);
    const head = Buffer.from(bytes.subarray(0, 5)).toString('ascii');
    expect(head).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  // Regression: pdf-lib's standard fonts are WinAnsi-only and `drawText` /
  // `widthOfTextAtSize` THROW on anything outside it, so real post bodies
  // (emoji), Polish org/customer names and smart quotes turned the whole
  // report endpoint into a 500. Every string that reaches the page must be
  // transliterated/stripped first.
  it('renders non-WinAnsi text (emoji, Polish, CJK) without throwing', async () => {
    const bytes = await new ReportPdfService().generate({
      ...sample,
      branding: { name: 'Łukasz — Zażółć gęślą jaźń', logo: null },
      customer: { id: 'c1', name: 'Ćma Ćwierć' },
      delivery: {
        ...sample.delivery,
        perChannel: [
          { name: 'Wrocław IG', providerIdentifier: 'instagram', disabled: false, published: 4 },
        ],
      },
      engagement: [{ metric: 'Zasięg', total: 1200 }],
      topPosts: [
        {
          content: 'she watches the city go quiet. 🌙 — “smart” quotes',
          releaseURL: 'https://x/1',
          publishedAt: '2026-08-01T00:00:00.000Z',
          channel: 'Wrocław IG',
          engagement: 900,
        },
        {
          content: '日本語テスト Привет',
          releaseURL: null,
          publishedAt: '2026-08-02T00:00:00.000Z',
          channel: 'Wrocław IG',
          engagement: 10,
        },
      ],
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-');
  });

  it('handles an empty report without throwing', async () => {
    const bytes = await new ReportPdfService().generate({
      ...sample,
      engagement: [],
      topPosts: [],
      delivery: { channels: 0, activeChannels: 0, published: 0, perChannel: [] },
    });
    expect(Buffer.from(bytes.subarray(0, 5)).toString('ascii')).toBe('%PDF-');
  });
});
