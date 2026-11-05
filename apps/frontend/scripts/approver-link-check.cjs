#!/usr/bin/env node
/* eslint-disable */
/**
 * Headless checks for the public approver link page (/approve/<token>).
 *
 *   node apps/frontend/scripts/approver-link-check.cjs [--base http://localhost:4200] [--out <dir>]
 *
 * Does not start servers. The base URL must be a running `next dev`/`next start`
 * built with NEXT_PUBLIC_BACKEND_URL=http://localhost:3000. All requests to
 * http://localhost:3000/** are mocked with page.route. Screenshots go to --out.
 * Prints "SKIP: playwright not installed" and exits 0 when playwright is missing.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
let playwright;
try { playwright = require("playwright"); } catch (e) { console.log("SKIP: playwright not installed"); process.exit(0); }

function arg(name, fb) { const i = process.argv.indexOf("--" + name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fb; }
const BASE = arg("base", "http://localhost:4200").replace(/\/$/, "");
const OUT = path.resolve(arg("out", path.join(os.tmpdir(), "approver-link-shots")));
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = "A".repeat(43);
const VIEWS = [[375, 812], [768, 1024], [1440, 900]];

const view = (over) => ({
  post: { text: "<b>Hello</b> world\nsecond line", media: [], publishDate: null },
  channel: { name: "Acme X", providerIdentifier: "X" },
  requester: { name: "Ola" },
  stage: { position: 1, total: 2, name: "Legal" },
  approver: { name: "Marek" },
  selfApprovalBlocked: false,
  expiresAt: new Date(Date.now() + 3600e3).toISOString(),
  challenge: "1.abc",
  ...over,
});
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); };

async function scenario(browser, name, handler, run) {
  for (const [w, h] of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(() => { try { localStorage.setItem("postsider:locale", "en"); } catch (e) {} });
    const page = await ctx.newPage();
    const calls = [];
    const logs = [];
    page.on("console", (m) => logs.push(m.text()));
    await page.route("http://localhost:3000/**", (route) => {
      const req = route.request();
      calls.push({ method: req.method(), url: req.url(), body: req.postData(), headers: req.headers() });
      const u = req.url();
      if (u.includes("/public/approver-links/")) return handler(route, req, calls);
      return json(route, 404, {});
    });
    await page.goto(`${BASE}/approve/${TOKEN}${name === "valid" ? "?intent=reject" : ""}`);
    await page.waitForTimeout(600);
    if (run) await run(page, calls, logs, w);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(!overflow, `${name} ${w}px: horizontal scroll`);
    check(!logs.some((l) => l.includes(TOKEN)), `${name}: token in console`);
    await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`) });
    await ctx.close();
  }
}

(async () => {
  const browser = await playwright.chromium.launch();
  try {
    await scenario(browser, "valid", (r, req) => req.method() === "GET" ? json(r, 200, view()) : json(r, 200, { status: "PENDING", final: false, stage: 2 }),
      async (page, calls, logs, w) => {
        check(await page.locator("text=<b>Hello</b> world").count() === 1, "content must render as plain text");
        const approve = page.getByRole("button", { name: "Approve" });
        check(await approve.isDisabled(), "buttons disabled right after load");
        check(calls.filter((c) => c.method === "POST").length === 0, "GET must not post");
        check(calls.every((c) => !c.headers["auth"] && !c.headers["showorg"]), "no auth headers sent");
        await page.waitForTimeout(2200);
        check(await approve.isEnabled(), "buttons enable after the delay");
        if (w === 1440) {
          await approve.click();
          await page.waitForTimeout(400);
          check(await page.locator("text=next reviewer has been notified").count() === 1, "advanced message");
          const post = calls.find((c) => c.method === "POST");
          check(post && JSON.parse(post.body).decision === "approve" && JSON.parse(post.body).challenge === "1.abc", "decision body");
        }
      });
    await scenario(browser, "self-blocked", (r) => json(r, 200, view({ selfApprovalBlocked: true })),
      async (page) => {
        await page.waitForTimeout(2200);
        check(await page.getByRole("button", { name: "Approve" }).isDisabled(), "self blocked stays disabled");
        check(await page.locator("text=cannot approve a post you requested").count() >= 1, "self blocked reason");
      });
    await scenario(browser, "resolved", (r) => json(r, 409, { error: "approval_already_resolved", status: "APPROVED" }),
      async (page) => { check(await page.locator("text=already been decided").count() === 1, "resolved message"); });
    await scenario(browser, "invalid", (r) => json(r, 404, { error: "link_invalid" }),
      async (page) => { check(await page.locator("text=not valid anymore").count() === 1, "invalid message"); });
    // Stale challenge: first POST 404, re-GET, retry succeeds.
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      let posts = 0, gets = 0;
      await page.route("http://localhost:3000/**", (route) => {
        if (!route.request().url().includes("/public/approver-links/")) return json(route, 404, {});
        if (route.request().method() === "GET") { gets++; return json(route, 200, view({ challenge: `c${gets}` })); }
        posts++;
        return posts === 1 ? json(route, 404, { error: "link_invalid" }) : json(route, 200, { status: "APPROVED", final: true });
      });
      await page.goto(`${BASE}/approve/${TOKEN}`);
      await page.waitForTimeout(3000);
      await page.getByRole("button", { name: "Approve" }).click();
      await page.waitForTimeout(3600);
      check(gets === 2 && posts === 2, `stale challenge retry (gets=${gets}, posts=${posts})`);
      check(await page.locator("text=Approved. Thank you.").count() === 1, "approved message after retry");
      await ctx.close();
    }
  } finally { await browser.close(); }
  if (failures.length) { console.log("FAIL:\n- " + failures.join("\n- ")); process.exit(1); }
  console.log("OK, screenshots in " + OUT);
})();
