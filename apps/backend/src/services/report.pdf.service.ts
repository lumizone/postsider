import { Injectable } from '@nestjs/common';
import { PDFDocument, PDFFont, PDFImage, StandardFonts, rgb } from 'pdf-lib';

export interface ReportPdfInput {
  generatedAt: string;
  branding: { name: string; logo: string | null };
  customer: { id: string; name: string };
  period: { days: number; start: string; end: string };
  delivery: {
    channels: number;
    activeChannels: number;
    published: number;
    perChannel: Array<{
      name: string;
      providerIdentifier: string;
      disabled: boolean;
      published: number;
    }>;
  };
  engagement: Array<{ metric: string; total: number }>;
  topPosts: Array<{
    content: string;
    releaseURL: string | null;
    publishedAt: string;
    channel: string;
    engagement: number;
  }>;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const BOTTOM = 56;
const BLACK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.45, 0.45, 0.45);
const LINE = rgb(0.88, 0.88, 0.88);

const stripHtml = (value: string) =>
  value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const shortDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

async function fetchLogo(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

@Injectable()
export class ReportPdfService {
  async generate(data: ReportPdfInput): Promise<Uint8Array> {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

    let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    const ensureSpace = (needed: number) => {
      if (y - needed < BOTTOM) {
        page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - MARGIN;
      }
    };

    const drawText = (
      text: string,
      opts: { font?: PDFFont; size?: number; color?: typeof BLACK; x?: number; leading?: number },
    ) => {
      const { font = regular, size = 10, color = BLACK, x = MARGIN, leading = size * 1.35 } = opts;
      page.drawText(text, { x, y, size, font, color });
      y -= leading;
    };

    const drawWrapped = (
      text: string,
      font: PDFFont,
      size: number,
      color: typeof BLACK,
      maxWidth: number,
      maxLines: number,
      x = MARGIN,
    ) => {
      const words = text.split(/\s+/).filter(Boolean);
      let line = '';
      let lines = 0;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(test, size) <= maxWidth) {
          line = test;
        } else {
          if (lines >= maxLines - 1) {
            // Truncate the last allowed line with an ellipsis.
            while (line && font.widthOfTextAtSize(`${line}…`, size) > maxWidth) {
              line = line.slice(0, -1);
            }
            line = `${line}…`;
            page.drawText(line, { x, y, size, font, color });
            y -= size * 1.35;
            return;
          }
          page.drawText(line, { x, y, size, font, color });
          y -= size * 1.35;
          line = word;
          lines++;
        }
      }
      if (line && lines < maxLines) {
        page.drawText(line, { x, y, size, font, color });
        y -= size * 1.35;
      }
    };

    const divider = () => {
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.7, color: LINE });
      y -= 18;
    };

    // ---- Header ----------------------------------------------------------
    let logo: PDFImage | null = null;
    if (data.branding.logo) {
      const bytes = await fetchLogo(data.branding.logo);
      if (bytes) {
        try {
          // PNG magic 0x89 0x50, JPEG magic 0xFF 0xD8.
          const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
          logo = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
        } catch {
          logo = null;
        }
      }
    }

    if (logo) {
      const dims = logo.scaleToFit(180, 56);
      page.drawImage(logo, { x: MARGIN, y: y - dims.height, width: dims.width, height: dims.height });
      y -= dims.height + 12;
    }

    drawText(data.branding.name || 'Report', { font: bold, size: 22, color: BLACK });
    drawText('Social media report', { size: 11, color: MUTED });
    y -= 10;
    drawText(`Prepared for ${data.customer.name}`, { size: 12, color: BLACK });
    drawText(
      `Last ${data.period.days} days · ${shortDate(data.period.start)} – ${shortDate(data.period.end)}`,
      { size: 9, color: MUTED },
    );
    y -= 8;
    divider();

    // ---- Performance (engagement) ----------------------------------------
    drawText('Performance', { font: bold, size: 14 });
    if (data.engagement.length === 0) {
      drawText('Engagement data is not available for this period yet.', { size: 10, color: MUTED });
    } else {
      const metrics = data.engagement.slice(0, 6);
      const colWidth = (PAGE_WIDTH - MARGIN * 2) / 2;
      let leftCol = true;
      for (const m of metrics) {
        ensureSpace(16);
        const x = leftCol ? MARGIN : MARGIN + colWidth;
        page.drawText(m.metric, { x, y, size: 10, font: regular, color: MUTED });
        page.drawText(String(m.total).replace(/\B(?=(\d{3})+(?!\d))/g, ','), { x, y: y - 14, size: 20, font: bold, color: BLACK });
        if (leftCol) {
          leftCol = false;
        } else {
          leftCol = true;
          y -= 34;
        }
      }
      if (!leftCol) y -= 34;
    }
    y -= 8;
    divider();

    // ---- Delivery ---------------------------------------------------------
    drawText('Delivery', { font: bold, size: 14 });
    drawText(
      `${data.delivery.channels} channels · ${data.delivery.activeChannels} active · ${data.delivery.published} posts published`,
      { size: 10, color: MUTED },
    );
    y -= 6;
    for (const channel of data.delivery.perChannel) {
      ensureSpace(14);
      const status = channel.disabled ? 'disabled' : 'active';
      page.drawText(channel.name, { x: MARGIN, y, size: 10, font: regular, color: BLACK });
      page.drawText(String(channel.published), { x: MARGIN + 180, y, size: 10, font: bold, color: BLACK });
      page.drawText(status, { x: MARGIN + 230, y, size: 9, font: regular, color: channel.disabled ? MUTED : rgb(0.09, 0.5, 0.24) });
      y -= 14;
    }
    y -= 8;
    divider();

    // ---- Top posts --------------------------------------------------------
    drawText('Top posts', { font: bold, size: 14 });
    if (data.topPosts.length === 0) {
      drawText('No published posts in this period.', { size: 10, color: MUTED });
    }
    for (const post of data.topPosts) {
      ensureSpace(64);
      const heading = `${post.channel} · ${shortDate(post.publishedAt)}` +
        (post.engagement > 0 ? ` · ${post.engagement} engagement` : '');
      drawText(heading, { size: 9, color: MUTED });
      drawWrapped(stripHtml(post.content), regular, 10, BLACK, PAGE_WIDTH - MARGIN * 2, 3);
      if (post.releaseURL) {
        drawText(post.releaseURL, { size: 8, color: MUTED });
      }
      y -= 12;
    }

    return pdf.save();
  }
}
