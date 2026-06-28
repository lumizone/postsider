import { familyFor } from "./preview-families";
import { truncateBody, mediaAspectRatio, previewFold } from "./preview-utils";

describe("familyFor", () => {
  it("maps known microblog/video/instagram/article providers", () => {
    expect(familyFor("x")).toBe("microblog");
    expect(familyFor("tiktok")).toBe("video");
    expect(familyFor("instagram")).toBe("instagram");
    expect(familyFor("devto")).toBe("article");
  });
  it("maps provider variants by base segment", () => {
    expect(familyFor("linkedin-page")).toBe("linkedin");
    expect(familyFor("mastodon-custom")).toBe("microblog");
  });
  it("falls back to community for unknown / empty", () => {
    expect(familyFor("something-weird")).toBe("community");
    expect(familyFor(undefined)).toBe("community");
  });
});

describe("truncateBody", () => {
  it("does not truncate under the limit", () => {
    expect(truncateBody("hello", 10)).toEqual({ text: "hello", truncated: false });
  });
  it("truncates over the limit", () => {
    expect(truncateBody("hello world", 5)).toEqual({ text: "hello", truncated: true });
  });
  it("treats max <= 0 as no limit", () => {
    expect(truncateBody("hello", 0)).toEqual({ text: "hello", truncated: false });
  });
});

describe("mediaAspectRatio", () => {
  it("uses 9/16 for vertical video", () => {
    expect(mediaAspectRatio("video")).toBe("9 / 16");
  });
  it("uses 1/1 for an instagram feed post and 9/16 for a story", () => {
    expect(mediaAspectRatio("instagram")).toBe("1 / 1");
    expect(mediaAspectRatio("instagram", "story")).toBe("9 / 16");
  });
  it("uses 16/9 for linkedin/article", () => {
    expect(mediaAspectRatio("linkedin")).toBe("16 / 9");
    expect(mediaAspectRatio("article")).toBe("16 / 9");
  });
});

describe("previewFold", () => {
  it("returns platform folds", () => {
    expect(previewFold("instagram")).toBe(125);
    expect(previewFold("linkedin")).toBe(210);
    expect(previewFold("microblog")).toBe(0);
  });
});
