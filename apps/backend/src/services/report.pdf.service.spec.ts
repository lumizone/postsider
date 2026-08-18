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
