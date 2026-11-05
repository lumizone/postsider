/* eslint-disable */
/**
 * Backend fixtures for agent-center-check.cjs. Pure data and routing, no Playwright.
 * Response shapes follow the dashboard controllers (agent-activity, policies,
 * approval, settings/api-keys) and the types in src/lib/agent-activity-api.ts
 * and src/lib/policies-api.ts. ASCII only: no em or en dashes anywhere.
 *
 * createFixtures({ world, role }) returns { handle(method, url, body), calls }.
 *   world "default": 10 groups, one per row bucket.
 *   world "many":    60 groups with one pending approval each (bulk cap test).
 *   role: "ADMIN" (default) or "USER".
 *   failPolicyUpdate: true makes PUT /policies/:id answer 500 (toggle rollback check).
 */

const NOW = Date.now();
const iso = (minutesAgo) => new Date(NOW - minutesAgo * 60000).toISOString();

const CHANNELS = [
  { id: "int-tt", name: "Studio TikTok", identifier: "tiktok" },
  { id: "int-x", name: "Studio on X", identifier: "x" },
  { id: "int-li", name: "Studio LinkedIn", identifier: "linkedin" },
];

const backendIntegration = (c) => ({
  id: c.id,
  internalId: c.id + "-internal",
  name: c.name,
  identifier: c.identifier,
  picture: null,
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  display: null,
  type: "social",
  time: [{ time: 120 }],
  changeProfilePicture: false,
  changeNickName: false,
  customer: null,
  additionalSettings: "[]",
  editor: "normal",
  stripLinks: false,
  isCustomFields: false,
});

const keyActor = (id, name, state) => ({ type: "API_KEY", id, name, state: state || "ok", authorizedBy: null });
const OAUTH = { type: "OAUTH_CLIENT", id: "oc-1", name: "Claude Desktop", state: "ok", authorizedBy: "Ada Admin" };
const LEGACY = { type: "API_KEY", id: null, name: null, state: "legacy", authorizedBy: null };
const REVOKED_EMPTY = { type: "API_KEY", id: "k-gone", name: "", state: "revoked", authorizedBy: null };
const USER_ACTOR = { type: "USER", id: "u-1", name: "Ada Admin", state: "ok", authorizedBy: null };

const dest = (group, n, ch, state, bucket, extra) =>
  Object.assign(
    {
      postId: group + "-p" + n,
      integrationId: ch.id,
      integrationName: ch.name,
      providerIdentifier: ch.identifier,
      picture: null,
      state,
      bucket,
      errorCategory: null,
      errorRetryable: null,
      publishAttempts: 0,
      releaseURL: null,
      publishDate: iso(-90),
    },
    extra || {}
  );

const claimed = (agentName) => ({ agentName: agentName || null, workflowId: null, runId: null, externalRef: null, source: agentName ? "n8n" : null });

function defaultGroups() {
  const [tt, x, li] = CHANNELS;
  return [
    {
      group: "g-unknown", updatedAt: iso(3), bucket: "unknown_outcome",
      contentPreview: "Launch week recap: three things we shipped and one we deliberately did not.",
      destinations: [
        dest("g-unknown", 1, tt, "ERROR", "unknown_outcome", { errorCategory: "UNKNOWN_OUTCOME", errorRetryable: false, publishAttempts: 2 }),
        dest("g-unknown", 2, x, "PUBLISHED", "published", { releaseURL: "https://example.com/post/1", publishDate: iso(5) }),
      ],
      createdBy: keyActor("k-1", "n8n production"), lastModifiedBy: keyActor("k-1", "n8n production"),
      claimed: claimed("Research bot"), pendingApprovalIds: [], canRetry: true,
    },
    {
      group: "g-blocked", updatedAt: iso(12), bucket: "blocked",
      contentPreview: "Big announcement with a tracking link https://example.com/?utm=x",
      destinations: [dest("g-blocked", 1, li, "ERROR", "blocked", { errorCategory: "POLICY_BLOCKED", errorRetryable: false })],
      createdBy: OAUTH, lastModifiedBy: OAUTH, claimed: claimed(null), pendingApprovalIds: [], canRetry: false,
    },
    {
      group: "g-retry", updatedAt: iso(25), bucket: "retryable",
      contentPreview: "Thread: how our queue plan picks the best slot for every channel.",
      destinations: [dest("g-retry", 1, x, "ERROR", "retryable", { errorCategory: "RATE_LIMITED", errorRetryable: true, publishAttempts: 1 })],
      createdBy: keyActor("k-1", "n8n production"), lastModifiedBy: keyActor("k-1", "n8n production"),
      claimed: claimed(null), pendingApprovalIds: [], canRetry: true,
    },
    {
      group: "g-other", updatedAt: iso(40), bucket: "failed_other",
      contentPreview: "Video teaser for the spring campaign.",
      destinations: [dest("g-other", 1, tt, "ERROR", "failed_other", { errorCategory: "INVALID_CONTENT", errorRetryable: false, publishAttempts: 1 })],
      createdBy: REVOKED_EMPTY, lastModifiedBy: REVOKED_EMPTY, claimed: claimed(null), pendingApprovalIds: [], canRetry: true,
    },
    {
      group: "g-review", updatedAt: iso(55), bucket: "review",
      contentPreview: "Weekly digest draft written by the content agent, waiting for a human.",
      destinations: [dest("g-review", 1, li, "APPROVAL", "review")],
      createdBy: keyActor("k-2", "Content agent"), lastModifiedBy: keyActor("k-2", "Content agent"),
      claimed: claimed("Digest writer"), pendingApprovalIds: ["ap-review-1"], canRetry: false,
    },
    {
      group: "g-review2", updatedAt: iso(70), bucket: "review",
      contentPreview: "Two channel campaign post that needs approval on both channels.",
      destinations: [
        dest("g-review2", 1, x, "APPROVAL", "review"),
        dest("g-review2", 2, li, "APPROVAL", "review"),
      ],
      createdBy: OAUTH, lastModifiedBy: OAUTH, claimed: claimed(null), pendingApprovalIds: ["ap-review2-1", "ap-review2-2"], canRetry: false,
    },
    {
      // The detail of this group answers 404: "This post changed".
      group: "g-gone", updatedAt: iso(90), bucket: "held",
      contentPreview: "Held while publishing is paused for the organization.",
      destinations: [dest("g-gone", 1, x, "HELD", "held")],
      createdBy: USER_ACTOR, lastModifiedBy: USER_ACTOR, claimed: claimed(null), pendingApprovalIds: [], canRetry: false,
    },
    {
      group: "g-sched", updatedAt: iso(120), bucket: "scheduled",
      contentPreview: "Friday teaser queued for tomorrow morning.",
      destinations: [dest("g-sched", 1, tt, "QUEUE", "scheduled")],
      createdBy: keyActor("k-1", "n8n production"), lastModifiedBy: USER_ACTOR, claimed: claimed(null), pendingApprovalIds: [], canRetry: false,
    },
    {
      group: "g-draft", updatedAt: iso(180), bucket: "draft",
      contentPreview: "",
      destinations: [dest("g-draft", 1, li, "DRAFT", "draft")],
      createdBy: USER_ACTOR, lastModifiedBy: USER_ACTOR, claimed: claimed(null), pendingApprovalIds: [], canRetry: false,
    },
    {
      group: "g-pub", updatedAt: iso(240), bucket: "published",
      contentPreview: "Published: our changelog for the month.",
      destinations: [dest("g-pub", 1, x, "PUBLISHED", "published", { releaseURL: "https://example.com/post/2", publishDate: iso(240) })],
      createdBy: LEGACY, lastModifiedBy: LEGACY, claimed: claimed(null), pendingApprovalIds: [], canRetry: false,
    },
  ];
}

function manyGroups() {
  const out = [];
  for (let i = 1; i <= 60; i++) {
    const id = "m" + String(i).padStart(2, "0");
    out.push({
      group: "g-" + id, updatedAt: iso(i), bucket: "review",
      contentPreview: "Bulk fixture post number " + i,
      destinations: [dest("g-" + id, 1, CHANNELS[i % 3], "APPROVAL", "review")],
      createdBy: keyActor("k-2", "Content agent"), lastModifiedBy: keyActor("k-2", "Content agent"),
      claimed: claimed(null), pendingApprovalIds: ["ap-" + id], canRetry: false,
    });
  }
  return out;
}

const TIMELINE_TYPES = [
  "post.created", "post.policy_evaluated", "post.approval_requested", "post.approval_resolved",
  "post.updated", "post.status_changed", "post.failed", "post.retry_requested",
  "post.failed", "post.policy_evaluated", "post.updated", "post.status_changed",
];

function detailFor(g) {
  const chById = (id) => CHANNELS.find((c) => c.id === id) || CHANNELS[0];
  const destinations = g.destinations.map((d, i) => {
    const ch = chById(d.integrationId);
    const hasApproval = g.pendingApprovalIds.length > 0 || g.group === "g-unknown";
    const pending = g.pendingApprovalIds[i] || null;
    return {
      postId: d.postId,
      integration: { id: ch.id, name: ch.name, providerIdentifier: ch.identifier, picture: null },
      state: d.state, bucket: d.bucket, errorCategory: d.errorCategory, errorRetryable: d.errorRetryable,
      errorMessage: d.errorCategory ? "Provider answered with status 429 for request abc123." : null,
      publishAttempts: d.publishAttempts, lastPublishAttemptAt: d.publishAttempts ? iso(8) : null,
      releaseURL: d.releaseURL, publishDate: d.publishDate,
      contentText:
        i === 0
          ? "Launch week recap: three things we shipped and one we deliberately did not. Read more on our blog."
          : "Launch week recap: three things we shipped. Read the full story on our blog today.",
      image: null, thread: [], firstComment: i === 0 && g.group === "g-unknown" ? "Link in the first comment." : null,
      createdBy: g.createdBy, lastModifiedBy: g.lastModifiedBy, claimed: g.claimed,
      approval: hasApproval
        ? pending
          ? { id: pending, status: "PENDING", note: null, requestedAt: iso(60), resolvedAt: null, requestedBy: g.createdBy, decidedBy: null }
          : g.group === "g-unknown" && i === 1
            ? { id: "ap-done", status: "APPROVED", note: "Looks good to me.", requestedAt: iso(300), resolvedAt: iso(280), requestedBy: g.createdBy, decidedBy: { type: "GUEST", name: "Pat Reviewer", email: "pat@example.com" } }
            : null
        : null,
    };
  });
  const timeline = TIMELINE_TYPES.map((type, i) => ({
    id: g.group + "-ev" + i,
    type,
    createdAt: iso(300 - i * 20),
    postId: g.destinations[0].postId,
    actor: type === "post.approval_resolved" ? { type: "GUEST" } : i % 3 === 0 ? g.createdBy : { type: "SYSTEM", id: null, name: null, state: "ok", authorizedBy: null },
    metadata:
      type === "post.failed"
        ? { errorCategory: "RATE_LIMITED", errorRetryable: true }
        : type === "post.policy_evaluated"
          ? { effect: "BLOCK", phase: "write", ruleNames: "No links from agents" }
          : {},
  }));
  return {
    group: g.group, updatedAt: g.updatedAt, destinations,
    policy: {
      recorded: { effect: "BLOCK", phase: "write", at: iso(250), ruleNames: ["No links from agents"], matchedCount: 1 },
      current: { effect: "REQUIRE_APPROVAL", matched: [{ ruleId: "r1", name: "Approve every automated post", effect: "REQUIRE_APPROVAL", condition: "ALWAYS" }] },
    },
    timeline,
  };
}

const POLICIES = [
  {
    id: "r1", name: "Approve every automated post", displayName: "Approve every automated post", enabled: true, priority: 10,
    appliesToActorTypes: [], appliesToApiKeyIds: [], appliesToIntegrationIds: [], appliesToProviders: [],
    condition: "ALWAYS", conditionParams: {}, effect: "REQUIRE_APPROVAL",
  },
  {
    id: "r2", name: "No links from agents", displayName: "No links from agents", enabled: true, priority: 20,
    appliesToActorTypes: ["API_KEY", "OAUTH_CLIENT"], appliesToApiKeyIds: ["k-1"], appliesToIntegrationIds: ["int-x"], appliesToProviders: ["x"],
    condition: "CONTAINS_LINK", conditionParams: {}, effect: "BLOCK",
  },
  {
    id: "r3", name: "Quiet words", displayName: "Quiet words", enabled: false, priority: 30,
    appliesToActorTypes: [], appliesToApiKeyIds: [], appliesToIntegrationIds: [], appliesToProviders: [],
    condition: "CONTAINS_WORDS", conditionParams: { words: ["giveaway", "free money"] }, effect: "BLOCK",
  },
  {
    // The stored name has a bidi override and a zero width space: only the edit input may show it.
    id: "r4", name: "Raw\u202E Name\u200B", displayName: "Clean Name", enabled: true, priority: 40,
    appliesToActorTypes: [], appliesToApiKeyIds: [], appliesToIntegrationIds: [], appliesToProviders: [],
    condition: "ALWAYS", conditionParams: {}, effect: "REQUIRE_APPROVAL",
  },
];

function createFixtures(opts) {
  const role = (opts && opts.role) || "ADMIN";
  const world = (opts && opts.world) || "default";
  const groups = world === "many" ? manyGroups() : defaultGroups();
  const calls = [];
  const json = (body, status) => ({ status: status || 200, body });

  function summary() {
    return {
      timezone: "Europe/Warsaw", dayStart: iso(600), dayEnd: iso(-800),
      actionsToday: 14, waitingForReview: groups.filter((g) => g.bucket === "review").length, policyBlocked: 1,
      failed: { total: 3, retryable: 1, unknownOutcome: 1, other: 1 }, publishedToday: 4,
    };
  }

  function handle(method, urlString, rawBody) {
    const url = new URL(urlString);
    const path = url.pathname;
    let body = null;
    try { body = rawBody ? JSON.parse(rawBody) : null; } catch (e) { body = rawBody; }
    if (method !== "GET") calls.push({ method, path, body });

    if (path === "/user/self") {
      return json({
        id: "u-1", email: "ada@example.com", name: "Ada Admin", orgId: "org-1", totalChannels: 3, tier: "PRO",
        role, isLifetime: false, admin: role !== "USER", impersonate: false, isTrailing: false, allowTrial: false,
        onTrial: false, trialDaysLeft: null, publicApi: "k", isPlatformAi: false, aiUsage: null, agencyMode: false,
      });
    }
    if (path === "/user/organizations") return json([{ id: "org-1", name: "Studio", users: [{ role }], logo: null }]);
    if (path === "/integrations/list") return json({ integrations: CHANNELS.map(backendIntegration) });

    if (path === "/agent-activity/summary") return json(summary());
    if (path === "/agent-activity/filters") {
      return json({
        actors: [
          { key: "API_KEY:k-1", type: "API_KEY", id: "k-1", name: "n8n production", state: "ok" },
          { key: "API_KEY:k-gone", type: "API_KEY", id: "k-gone", name: "", state: "revoked" },
          { key: "OAUTH_CLIENT:oc-1", type: "OAUTH_CLIENT", id: "oc-1", name: "Claude Desktop", state: "ok" },
        ],
        agentNames: [{ value: "Research bot", label: "Research bot" }, { value: "Digest writer", label: "Digest writer" }],
        sources: [{ value: "n8n", label: "n8n" }],
      });
    }
    let m = path.match(/^\/agent-activity\/groups\/([^/]+)\/retry-failed$/);
    if (m && method === "POST") {
      const group = decodeURIComponent(m[1]);
      return json({
        group,
        results: [{ postId: group + "-p1", integrationId: "int-x", previousState: "ERROR", action: "requeued" }],
        policy: null,
      });
    }
    m = path.match(/^\/agent-activity\/groups\/([^/]+)$/);
    if (m && method === "GET") {
      const g = groups.find((x) => x.group === decodeURIComponent(m[1]));
      if (!g || g.group === "g-gone") return json({ message: "Not found" }, 404);
      return json(detailFor(g));
    }
    if (path === "/agent-activity/approvals/bulk" && method === "POST") {
      const ids = (body && body.approvalIds) || [];
      return json({
        results: ids.map((id) => ({ approvalId: id, postId: null, status: "done" })),
        summary: { done: ids.length, skipped: 0, failed: 0 },
      });
    }
    if (path === "/agent-activity" && method === "GET") {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 25));
      const offset = Number(url.searchParams.get("cursor")) || 0;
      const page = groups.slice(offset, offset + limit);
      const next = offset + limit < groups.length ? String(offset + limit) : null;
      return json({ groups: page, nextCursor: next });
    }

    if (/^\/approval\/[^/]+\/(approve|reject)$/.test(path)) return json({ ok: true });
    if (path === "/approval/pending") return json([]);

    if (path === "/policies" && method === "GET") return json({ policies: POLICIES });
    if (path === "/policies/evaluate") {
      return json({
        effect: "REQUIRE_APPROVAL",
        matched: [{ ruleId: "r1", name: "Approve every automated post", effect: "REQUIRE_APPROVAL", condition: "ALWAYS" }],
        channels: [{ integrationId: "int-tt", effect: "REQUIRE_APPROVAL" }],
        key: { allowed: true },
      });
    }
    if (path === "/policies" && method === "POST") return json(Object.assign({ id: "r-new", displayName: (body && body.name) || "" }, body || {}), 201);
    if (/^\/policies\/[^/]+$/.test(path) && method === "PUT" && opts && opts.failPolicyUpdate) {
      return json({ message: "Policy store unavailable" }, 500);
    }
    if (/^\/policies\/[^/]+$/.test(path)) return json(method === "DELETE" ? {} : Object.assign({}, POLICIES[0], body || {}));

    if (path === "/settings/api-keys" && method === "GET") {
      return json([
        {
          id: "k-1", name: "n8n production",
          scopes: ["posts:read", "posts:write", "channels:read"],
          allowedActions: ["DRAFT", "SCHEDULE"], allowedIntegrationIds: ["int-x"], createdAt: iso(60 * 24 * 12),
        },
        { id: "k-2", name: "Content agent", scopes: ["posts:read"], allowedActions: [], allowedIntegrationIds: [], createdAt: iso(60 * 24 * 40) },
        // Only restriction is a channel that no longer exists.
        { id: "k-3", name: "Dead channel key", scopes: ["posts:read"], allowedActions: [], allowedIntegrationIds: ["int-gone"], createdAt: iso(60 * 24 * 30) },
        // A live and a dead channel plus an action limit.
        { id: "k-4", name: "Mixed key", scopes: ["posts:read"], allowedActions: ["DRAFT"], allowedIntegrationIds: ["int-x", "int-gone"], createdAt: iso(60 * 24 * 20) },
      ]);
    }
    if (/^\/settings\/api-keys\/[^/]+$/.test(path) && method === "PUT") return json(Object.assign({}, body || {}));

    return json([]);
  }

  return { handle, calls, channels: CHANNELS };
}

module.exports = { createFixtures };
