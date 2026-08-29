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

/**
 * pdf-lib's standard fonts are WinAnsi (CP1252) only: `drawText` THROWS on any
 * character outside it — emoji ("WinAnsi cannot encode 0x1f319"), Polish
 * ą/ę/ł/ż/ś/ć/ń/ź, Cyrillic, CJK, and the curly quotes editors insert. Post
 * bodies, org names, customer names and channel names are all free text, so an
 * unsanitised draw turned the whole report endpoint into a 500 for a large
 * share of real data. Everything drawn on the page goes through here.
 *
 * Latin letters are decomposed to their base form (ż → z) so text stays
 * readable; anything else with no sensible ASCII shape is dropped. Rendering
 * these scripts properly needs an embedded Unicode TTF (fontkit) — tracked
 * separately; this keeps the endpoint alive rather than pretending otherwise.
 */
// ASCII printable + Latin-1 supplement + the CP1252 punctuation block that
// WinAnsi maps into 0x80-0x9F (curly quotes, dashes, bullet, ellipsis).
const WIN_ANSI_SAFE =
  /[\u0020-\u007e\u00a0-\u00ff\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178]/;
// Letters whose NFD form keeps a non-WinAnsi base (no combining mark to strip).
const LATIN_FALLBACK: Record<string, string> = {
  ł: 'l', Ł: 'L', đ: 'd', Đ: 'D', ø: 'o', Ø: 'O',
  ħ: 'h', Ħ: 'H', ŧ: 't', Ŧ: 'T', ı: 'i', ĸ: 'k',
};

const toWinAnsi = (value: string): string => {
  let out = '';
  for (const char of value) {
    if (WIN_ANSI_SAFE.test(char)) {
      out += char;
      continue;
    }
    // Strip combining marks: "ż" (U+017C) decomposes to "z" + U+0307.
    const folded = char
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split('')
      .filter((c) => WIN_ANSI_SAFE.test(c))
      .join('');
    // No combining mark to strip (e.g. Polish l-stroke) - map explicitly.
    out += folded || LATIN_FALLBACK[char] || '';
  }
  return out;
};

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
      page.drawText(toWinAnsi(text), { x, y, size, font, color });
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
      // Sanitise BEFORE measuring: widthOfTextAtSize throws on unencodable
      // characters just like drawText does.
      const words = toWinAnsi(text).split(/\s+/).filter(Boolean);
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
        page.drawText(toWinAnsi(m.metric), { x, y, size: 10, font: regular, color: MUTED });
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
      page.drawText(toWinAnsi(channel.name), { x: MARGIN, y, size: 10, font: regular, color: BLACK });
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
