import type { PreviewFamily } from "./preview-families";

export const INSTAGRAM_FOLD = 125;
export const LINKEDIN_FOLD = 210;

// Truncate body text at `max` characters. max <= 0 means "no limit".
export function truncateBody(
  body: string,
  max: number
): { text: string; truncated: boolean } {
  if (max <= 0 || body.length <= max) return { text: body, truncated: false };
  return { text: body.slice(0, max), truncated: true };
}

export function bodyToParagraphs(body: string): string[] {
  return body.split("\n");
}

// CSS aspect-ratio value for media framing, per family + (optional) post type.
export function mediaAspectRatio(
  family: PreviewFamily,
  postType?: string
): string {
  switch (family) {
    case "video":
      return "9 / 16";
    case "instagram":
      return postType === "story" ? "9 / 16" : "1 / 1";
    case "linkedin":
    case "facebook":
    case "article":
      return "16 / 9";
    default:
      return "1.91 / 1";
  }
}

// The soft "fold" length where a platform shows a "...more" affordance, used
// purely for the preview (does not change what gets published).
export function previewFold(family: PreviewFamily): number {
  if (family === "instagram") return INSTAGRAM_FOLD;
  if (family === "linkedin") return LINKEDIN_FOLD;
  return 0;
}
