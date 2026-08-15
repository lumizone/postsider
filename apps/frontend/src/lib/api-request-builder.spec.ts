import {
  buildPostBody,
  buildMultiPostBody,
  buildCurl,
  BuildPostInput,
} from "./api-request-builder";

const base: BuildPostInput = {
  integrationId: "int_1",
  content: "hello world",
  date: "2026-06-27T20:02:31",
  group: "grp1",
  valueId: "val1",
};

describe("buildPostBody", () => {
  it("wraps content in <p> and escapes HTML", () => {
    const body = buildPostBody({ ...base, content: "a < b & c" }) as any;
    expect(body.posts[0].value[0].content).toBe("<p>a &lt; b &amp; c</p>");
  });

  it("defaults type to schedule and carries group/valueId/date", () => {
    const body = buildPostBody(base) as any;
    expect(body.type).toBe("schedule");
    expect(body.date).toBe("2026-06-27T20:02:31");
    expect(body.posts[0].group).toBe("grp1");
    expect(body.posts[0].value[0].id).toBe("val1");
    expect(body.posts[0].integration.id).toBe("int_1");
  });

  it("emits an empty image array when no image", () => {
    const body = buildPostBody(base) as any;
    expect(body.posts[0].value[0].image).toEqual([]);
  });

  it("embeds the image with id + path when provided", () => {
    const body = buildPostBody({
      ...base,
      image: { id: "m1", path: "https://x/y.png" },
    }) as any;
    expect(body.posts[0].value[0].image[0]).toMatchObject({
      id: "m1",
      path: "https://x/y.png",
      alt: null,
      thumbnail: null,
      thumbnailTimestamp: null,
    });
  });

  it("passes through provider settings", () => {
    const body = buildPostBody({ ...base, settings: { post_type: "post" } }) as any;
    expect(body.posts[0].settings).toEqual({ post_type: "post" });
  });
});

describe("buildMultiPostBody", () => {
  it("emits one posts[] entry per channel, sharing group/content/date", () => {
    const body = buildMultiPostBody({
      channels: [
        { integrationId: "int_1", valueId: "v1", settings: { a: 1 } },
        { integrationId: "int_2", valueId: "v2" },
      ],
      content: "hi",
      date: "2026-06-27T20:02:31",
      group: "grp1",
    }) as any;
    expect(body.posts).toHaveLength(2);
    expect(body.posts[0].integration.id).toBe("int_1");
    expect(body.posts[0].settings).toEqual({ a: 1 });
    expect(body.posts[1].integration.id).toBe("int_2");
    expect(body.posts[1].settings).toEqual({});
    expect(body.posts[0].group).toBe("grp1");
    expect(body.posts[1].group).toBe("grp1");
    expect(body.posts[1].value[0].content).toBe("<p>hi</p>");
  });

  it("buildPostBody stays equivalent to a single-channel multi build", () => {
    const single = buildPostBody({
      integrationId: "int_1",
      content: "hello world",
      date: "2026-06-27T20:02:31",
      group: "grp1",
      valueId: "val1",
    });
    const multi = buildMultiPostBody({
      channels: [{ integrationId: "int_1", valueId: "val1" }],
      content: "hello world",
      date: "2026-06-27T20:02:31",
      group: "grp1",
    });
    expect(single).toEqual(multi);
  });
});

describe("buildCurl", () => {
  it("targets the public posts endpoint at the base url", () => {
    const curl = buildCurl(buildPostBody(base), "https://social.example.com");
    expect(curl).toContain("'https://social.example.com/public/v1/posts'");
  });

  it("uses a raw Authorization header (no Bearer)", () => {
    const curl = buildCurl(buildPostBody(base), "http://localhost:3000");
    expect(curl).toContain("Authorization: ps_YOUR_API_KEY");
    expect(curl).not.toContain("Bearer");
  });

  it("escapes single quotes inside the -d payload", () => {
    const curl = buildCurl(buildPostBody({ ...base, content: "it's fine" }), "http://x");
    expect(curl).toContain("'\\''");
  });
});
