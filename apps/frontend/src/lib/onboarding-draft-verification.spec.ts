import { isVerifiedOnboardingDraft } from "./onboarding-draft-verification";

const CHANNEL = "channel-123456";

test("requires exact draft id on one of this organization's connected channels", () => {
  expect(isVerifiedOnboardingDraft({
    group: "batch",
    posts: [{ id: "draft-123456", state: "DRAFT", integrationId: CHANNEL }],
  }, "draft-123456", [CHANNEL])).toBe(true);
});

test.each([
  ["wrong ID", { posts: [{ id: "different-123", state: "DRAFT", integrationId: CHANNEL }] }, "draft-123456", [CHANNEL]],
  ["published instead of draft", { posts: [{ id: "draft-123456", state: "PUBLISHED", integrationId: CHANNEL }] }, "draft-123456", [CHANNEL]],
  ["held instead of draft", { posts: [{ id: "draft-123456", state: "HELD", integrationId: CHANNEL }] }, "draft-123456", [CHANNEL]],
  ["other channel", { posts: [{ id: "draft-123456", state: "DRAFT", integrationId: "other" }] }, "draft-123456", [CHANNEL]],
  ["no channels", { posts: [{ id: "draft-123456", state: "DRAFT", integrationId: CHANNEL }] }, "draft-123456", []],
  ["null response", null, "draft-123456", [CHANNEL]],
  ["empty id", { posts: [{ id: "draft-123456", state: "DRAFT", integrationId: CHANNEL }] }, "", [CHANNEL]],
  ["absent posts", {}, "draft-123456", [CHANNEL]],
  ["missing integration", { posts: [{ id: "draft-123456", state: "DRAFT" }] }, "draft-123456", [CHANNEL]],
  ["malformed posts", { posts: "DRAFT" }, "draft-123456", [CHANNEL]],
  ["null item", { posts: [null] }, "draft-123456", [CHANNEL]],
])("%s is not accepted", (_case, value, id, channels) => {
  expect(isVerifiedOnboardingDraft(value, id, channels)).toBe(false);
});

test("a valid item can be found in a multi-channel post group", () => {
  expect(isVerifiedOnboardingDraft({
    posts: [
      { id: "other", state: "PUBLISHED", integrationId: "other" },
      { id: "draft-123456", state: "DRAFT", integrationId: CHANNEL },
    ],
  }, "draft-123456", [CHANNEL])).toBe(true);
});
