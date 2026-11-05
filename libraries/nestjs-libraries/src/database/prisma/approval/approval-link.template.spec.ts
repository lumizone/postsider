import { renderApproverEmail, escapeHtml } from './approval-link.template';

const ORIGINAL = process.env.FRONTEND_URL;
const base = {
  channelName: 'Acme',
  stageName: 'Legal',
  stageLabel: 'Stage 1 of 2',
  requesterName: 'Ann',
  preview: 'Hello world',
  approveUrl: 'https://app.example.com/approve/tok?intent=approve',
  rejectUrl: 'https://app.example.com/approve/tok?intent=reject',
};

describe('renderApproverEmail', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.example.com';
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = ORIGINAL;
  });

  it('renders both buttons and the plain fields', () => {
    const { subject, html } = renderApproverEmail(base);
    expect(subject).toContain('Stage 1 of 2');
    expect(html).toContain('Review and approve');
    expect(html).toContain('Review and reject');
    expect(html).toContain('href="https://app.example.com/approve/tok?intent=approve"');
    expect(html).toContain('href="https://app.example.com/approve/tok?intent=reject"');
    expect(html).toContain('Acme');
    expect(html).toContain('Hello world');
  });

  it('escapes script tags, quotes and ampersands in every interpolated field', () => {
    const evil = `<script>alert("x")</script> & 'q' "d"`;
    const { html, subject } = renderApproverEmail({
      ...base,
      channelName: evil,
      stageName: evil,
      stageLabel: evil,
      requesterName: evil,
      preview: evil,
    });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert("x")');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
    expect(html).toContain('&#39;');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('cuts the preview to 200 characters', () => {
    const { html } = renderApproverEmail({ ...base, preview: 'a'.repeat(500) });
    expect(html).toContain('a'.repeat(200));
    expect(html).not.toContain('a'.repeat(201));
  });

  it('contains no image tag and no raw html from the preview', () => {
    const { html } = renderApproverEmail({
      ...base,
      preview: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('keeps header injection out of the subject', () => {
    const { subject } = renderApproverEmail({
      ...base,
      stageLabel: 'Stage\r\nBcc: evil@example.com',
    });
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('throws when a url is on another origin or not http(s)', () => {
    expect(() =>
      renderApproverEmail({ ...base, approveUrl: 'https://evil.example.net/approve/tok' })
    ).toThrow();
    expect(() =>
      renderApproverEmail({ ...base, rejectUrl: 'https://app.example.com.evil.net/x' })
    ).toThrow();
    expect(() =>
      renderApproverEmail({ ...base, approveUrl: 'javascript:alert(1)' })
    ).toThrow();
    expect(() =>
      renderApproverEmail({ ...base, approveUrl: 'https://app.example.com@evil.net/x' })
    ).toThrow();
  });

  it('throws when FRONTEND_URL is not configured', () => {
    delete process.env.FRONTEND_URL;
    expect(() => renderApproverEmail(base)).toThrow();
  });

  it('escapeHtml covers the five significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
