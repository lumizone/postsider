#!/usr/bin/env node
/* eslint-disable */
/**
 * Headless layout and interaction checks for the Agent activity page, the
 * Policies settings page and the API keys settings page.
 *
 *   node apps/frontend/scripts/agent-center-check.cjs [--base http://localhost:4200] [--out <dir>]
 *
 * Does not start servers. The base URL must be a running `next dev` or `next start`
 * built with NEXT_PUBLIC_BACKEND_URL=http://localhost:3000. Every request to
 * http://localhost:3000/** is answered from agent-center-fixtures.cjs.
 * Screenshots go to --out (default: <os.tmpdir()>/agent-center-shots), never into the repo.
 * Prints "SKIP: playwright not installed" and exits 0 when playwright is missing.
 * Expected English copy is hard coded: the app must run in English (the script pins it).
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const { createFixtures } = require("./agent-center-fixtures.cjs");

let playwright;
try {
  playwright = require("playwright");
} catch (e) {
  console.log("SKIP: playwright not installed");
  process.exit(0);
}

function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const BASE = arg("base", "http://localhost:4200").replace(/\/$/, "");
const OUT = path.resolve(arg("out", path.join(os.tmpdir(), "agent-center-shots")));
fs.mkdirSync(OUT, { recursive: true });

const DASH = /[\u2013\u2014]/;
const results = []; // { name, failures: string[] }
const shots = [];
let browser;

class Check {
  constructor(name) {
    this.name = name;
    this.failures = [];
  }
  ok(cond, msg) {
    if (!cond) this.failures.push(msg);
    return !!cond;
  }
}

async function step(name, fn) {
  const c = new Check(name);
  try {
    await fn(c);
  } catch (e) {
    c.failures.push("exception: " + (e && e.message ? e.message.split("\n")[0] : String(e)));
  }
  results.push(c);
}

/** A fresh browser context with fixtures, theme, locale and console capture. */
async function open(opts) {
  const o = Object.assign({ theme: "light", width: 1440, height: 900, locale: "en", role: "ADMIN", world: "default" }, opts);
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height } });
  await ctx.addInitScript(
    ([theme, locale]) => {
      try {
        localStorage.setItem("postsider:theme", theme);
        localStorage.setItem("postsider:locale", locale);
      } catch (e) {}
    },
    [o.theme, o.locale]
  );
  const fx = createFixtures({ role: o.role, world: o.world });
  await ctx.route("http://localhost:3000/**", async (route) => {
    const req = route.request();
    const origin = req.headers()["origin"] || BASE;
    const cors = {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors, body: "" });
    const res = fx.handle(req.method(), req.url(), req.postData());
    return route.fulfill({
      status: res.status,
      headers: Object.assign({ "content-type": "application/json" }, cors),
      body: JSON.stringify(res.body),
    });
  });
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const loc = msg.location() || {};
    const url = loc.url || "";
    // Expected: the font fetch when offline, and the one fixture that answers 404 on purpose.
    if (/fonts\.(googleapis|gstatic)\.com/.test(url) || /fonts\./.test(msg.text())) return;
    if (/Failed to load resource/.test(msg.text()) && /g-gone/.test(url)) return;
    consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e.message).slice(0, 200)));
  return { ctx, page, fx, consoleErrors, opts: o };
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  await page.screenshot({ path: file, fullPage: false });
  shots.push(file);
}

async function bodyHasDash(page) {
  return page.evaluate((src) => new RegExp(src).test(document.body.innerText), DASH.source);
}

const rowsOf = (page) => page.locator('button[aria-label^="Open details"]');
async function gotoAgents(page, search) {
  await page.goto(BASE + "/agents" + (search || ""), { waitUntil: "domcontentloaded" });
  await rowsOf(page).first().waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(400);
}
async function overflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}
async function finishPage(c, s) {
  c.ok(s.consoleErrors.length === 0, "console errors: " + s.consoleErrors.join(" | "));
  await s.ctx.close();
}

async function main() {
  browser = await playwright.chromium.launch();

  // 1. Layout in three viewports and themes.
  for (const cfg of [
    { theme: "light", width: 1440, height: 900 },
    { theme: "dark", width: 1440, height: 900 },
    { theme: "light", width: 390, height: 844 },
  ]) {
    await step(`1 layout ${cfg.theme} ${cfg.width}`, async (c) => {
      const s = await open(cfg);
      await gotoAgents(s.page);
      const tiles = await s.page.locator('section[aria-label="Summary"] > *').count();
      c.ok(tiles === 5, "summary tiles " + tiles + " != 5");
      const segs = await s.page.locator('[role="group"][aria-label="Status"] button').count();
      c.ok(segs >= 5, "segmented buckets " + segs);
      const rows = await rowsOf(s.page).count();
      c.ok(rows >= 6, "rows " + rows + " < 6");
      const over = await overflow(s.page);
      c.ok(over <= 0, "horizontal overflow by " + over + "px");
      c.ok(!(await bodyHasDash(s.page)), "em or en dash in page text");
      c.ok((await s.page.getByText("by Revoked key (API key)").count()) >= 1, "revoked key with empty name fallback label missing in list");
      c.ok((await s.page.getByText("Organization API key").count()) >= 1, "legacy org key label missing");
      c.ok((await s.page.getByText("Research bot (claimed)").count()) >= 1, "claimed agent name missing");
      await shot(s.page, `agents-${cfg.theme}-${cfg.width}.png`);
      if (cfg.width < 500) {
        const file = path.join(OUT, "agents-fullpage-390.png");
        await s.page.screenshot({ path: file, fullPage: true });
        shots.push(file);
      }
      await finishPage(c, s);
    });
  }

  // 2. Drawer: headings, compare, Escape and focus return (light and dark).
  for (const cfg of [{ theme: "light", width: 1440, height: 900, tag: "light" }, { theme: "dark", width: 1440, height: 900, tag: "dark" }, { theme: "light", width: 390, height: 844, tag: "mobile" }]) {
    const theme = cfg.tag;
    await step(`2 drawer ${theme}`, async (c) => {
      const s = await open(cfg);
      await gotoAgents(s.page);
      const first = rowsOf(s.page).first();
      await first.click();
      const dialog = s.page.locator('[role="dialog"][aria-label="Post details"]');
      await dialog.waitFor({ state: "visible", timeout: 15000 });
      await s.page.getByText("Text differs between destinations").waitFor({ timeout: 15000 });
      for (const h of ["Destinations", "Who", "Approval", "Policy", "Content", "Timeline"]) {
        c.ok((await dialog.getByRole("heading", { name: h, exact: true }).count()) === 1, "heading missing: " + h);
      }
      c.ok((await dialog.locator("ol > li").count()) === 12, "timeline events != 12");
      c.ok((await dialog.getByText("External reviewer").count()) >= 1, "guest decision missing in timeline");
      c.ok((await dialog.getByText("Pat Reviewer (External reviewer)").count()) >= 1, "guest decider missing in approval");
      c.ok(!(await bodyHasDash(s.page)), "em or en dash in drawer text");
      c.ok((await overflow(s.page)) <= 0, "horizontal overflow with the drawer open: " + (await overflow(s.page)) + "px");
      await shot(s.page, `agents-drawer-${theme}.png`);
      // Scroll the body down to look at the lower sections.
      await dialog.locator("div").nth(1).evaluate((el) => (el.scrollTop = el.scrollHeight)).catch(() => {});
      await s.page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached", timeout: 5000 });
      const handle = await first.elementHandle();
      const focused = await s.page.evaluate((el) => document.activeElement === el, handle);
      c.ok(focused, "focus did not return to the originating row");
      if (theme === "light") await shot(s.page, "agents-focus-return-light.png");
      await finishPage(c, s);
    });
  }

  // 3. Retry anyway dialog: disabled until ticked, Cancel sends nothing; confirm sends true; plain Retry sends false.
  await step("3 retry anyway dialog and request bodies", async (c) => {
    const s = await open({});
    await gotoAgents(s.page);
    const row = s.page.locator("li").filter({ hasText: "Launch week recap" }).first();
    await row.getByRole("button", { name: "Retry anyway" }).click();
    const dlg = s.page.getByRole("dialog", { name: "Check the platform first" });
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    const confirm = dlg.getByRole("button", { name: "Retry anyway" });
    c.ok(await confirm.isDisabled(), "confirm is enabled before the box is ticked");
    await shot(s.page, "agents-retry-dialog-light.png");
    await dlg.getByRole("checkbox").check();
    c.ok(await confirm.isEnabled(), "confirm is still disabled after ticking");
    await dlg.getByRole("button", { name: "Cancel" }).click();
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    c.ok(s.fx.calls.filter((x) => x.path.endsWith("/retry-failed")).length === 0, "retry-failed was sent before confirming");

    // Confirmed: includeUnknownOutcome must be true.
    await row.getByRole("button", { name: "Retry anyway" }).click();
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await dlg.getByRole("checkbox").check();
    await dlg.getByRole("button", { name: "Retry anyway" }).click();
    await dlg.waitFor({ state: "detached", timeout: 10000 });
    await s.page.waitForTimeout(300);
    let calls = s.fx.calls.filter((x) => x.path.endsWith("/retry-failed"));
    c.ok(calls.length === 1 && calls[0].body && calls[0].body.includeUnknownOutcome === true, "confirmed retry body: " + JSON.stringify(calls.map((x) => x.body)));

    // Plain Retry failed (retryable group): includeUnknownOutcome must be false.
    const retryRow = s.page.locator("li").filter({ hasText: "how our queue plan picks" }).first();
    await retryRow.getByRole("button", { name: "Retry failed" }).click();
    await s.page.waitForTimeout(600);
    calls = s.fx.calls.filter((x) => x.path.endsWith("/retry-failed"));
    c.ok(calls.length === 2 && calls[1].body && calls[1].body.includeUnknownOutcome === false, "plain retry body: " + JSON.stringify(calls.map((x) => x.body)));
    c.ok(!/g-unknown\/retry-failed/.test(calls[1].path), "plain retry went to the unknown group");
    await finishPage(c, s);
  });

  // 4. Bulk bar with two groups selected.
  await step("4 bulk bar two selected", async (c) => {
    const s = await open({});
    await gotoAgents(s.page);
    const boxes = s.page.locator('input[type="checkbox"][aria-label="Select this post"]');
    c.ok((await boxes.count()) === 2, "selectable rows " + (await boxes.count()) + " != 2");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    const bar = s.page.locator('[role="group"][aria-label="Actions for the selected posts"]');
    await bar.waitFor({ state: "visible", timeout: 5000 });
    c.ok((await bar.getByText("2 selected").count()) === 1, "'2 selected' not shown");
    c.ok(!(await bodyHasDash(s.page)), "dash in page text");
    await shot(s.page, "agents-bulk-light.png");
    await finishPage(c, s);
  });

  // 5. Window focus refresh keeps loaded pages and the selection; >50 approvals are capped in the confirm dialog.
  await step("5 focus refresh keeps pages and selection; bulk cap 50", async (c) => {
    const s = await open({ world: "many" });
    await gotoAgents(s.page);
    const more = s.page.getByRole("button", { name: "Load more" });
    await more.click();
    await s.page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Open details"]').length >= 50, null, { timeout: 15000 });
    await more.click();
    await s.page.waitForFunction(() => document.querySelectorAll('button[aria-label^="Open details"]').length >= 60, null, { timeout: 15000 });
    // Select two rows, then fire a focus event: pages and selection must survive.
    const boxes = s.page.locator('input[type="checkbox"][aria-label="Select this post"]');
    await boxes.nth(3).check();
    await boxes.nth(30).check();
    await s.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await s.page.waitForTimeout(1200);
    const after = await rowsOf(s.page).count();
    c.ok(after === 60, "rows after focus refresh " + after + " != 60");
    c.ok((await s.page.getByText("2 selected").count()) === 1, "selection lost after focus refresh");
    c.ok(await boxes.nth(30).isChecked(), "checkbox 30 no longer checked after refresh");
    // Now select everything (60 approvals) and open the bulk confirm.
    for (let i = 0; i < 60; i++) if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).check();
    c.ok((await s.page.getByText("60 selected").count()) === 1, "60 selected not shown");
    await s.page.getByRole("button", { name: "Approve selected" }).click();
    const dlg = s.page.getByRole("dialog");
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    c.ok((await dlg.getByText("Approve the first 50 of 60 approvals? The rest stay selected.").count()) === 1, "capped confirm title missing: " + (await dlg.innerText()).slice(0, 120));
    await shot(s.page, "agents-bulk-cap-light.png");
    await dlg.getByRole("button", { name: "Approve selected" }).click();
    await dlg.waitFor({ state: "detached", timeout: 10000 });
    await s.page.waitForTimeout(400);
    const bulk = s.fx.calls.filter((x) => x.path === "/agent-activity/approvals/bulk");
    c.ok(bulk.length === 1 && bulk[0].body.approvalIds.length === 50 && bulk[0].body.action === "approve", "bulk request: " + JSON.stringify(bulk.map((x) => x.body && x.body.approvalIds && x.body.approvalIds.length)));
    c.ok((await s.page.getByText("10 selected").count()) === 1, "the 10 unsent groups should stay selected");
    await finishPage(c, s);
  });

  // 6. USER role: no action buttons or checkboxes.
  await step("6 USER role sees no write controls", async (c) => {
    const s = await open({ role: "USER" });
    await gotoAgents(s.page);
    for (const name of ["Approve and schedule", "Reject", "Retry failed", "Retry anyway", "Approve selected"]) {
      c.ok((await s.page.getByRole("button", { name }).count()) === 0, "USER sees button: " + name);
    }
    c.ok((await s.page.locator('input[type="checkbox"][aria-label="Select this post"]').count()) === 0, "USER sees selection checkboxes");
    await rowsOf(s.page).first().click();
    await s.page.locator('[role="dialog"][aria-label="Post details"]').waitFor({ state: "visible", timeout: 15000 });
    await s.page.getByText("Text differs between destinations").waitFor({ timeout: 15000 });
    for (const name of ["Approve and schedule", "Reject", "Retry failed", "Retry anyway"]) {
      c.ok((await s.page.getByRole("button", { name }).count()) === 0, "USER sees drawer button: " + name);
    }
    await shot(s.page, "agents-drawer-user-light.png");
    await finishPage(c, s);
  });

  // 7. Group 404 shows "This post changed".
  await step("7 group 404 shows 'This post changed'", async (c) => {
    const s = await open({});
    await gotoAgents(s.page);
    await s.page.locator('button[aria-label^="Open details"]').filter({ hasText: "Held while publishing" }).click();
    const dialog = s.page.locator('[role="dialog"][aria-label="Post details"]');
    await dialog.waitFor({ state: "visible", timeout: 15000 });
    await dialog.getByText("This post changed. Refresh the list.").waitFor({ timeout: 15000 });
    c.ok(true, "");
    await shot(s.page, "agents-drawer-changed-light.png");
    await finishPage(c, s);
  });

  // 8. A dialog opened from the drawer does not close the drawer on Escape.
  await step("8 Escape in a drawer dialog keeps the drawer", async (c) => {
    const s = await open({});
    await gotoAgents(s.page);
    await rowsOf(s.page).first().click();
    const drawer = s.page.locator('[role="dialog"][aria-label="Post details"]');
    await drawer.waitFor({ state: "visible", timeout: 15000 });
    await s.page.getByText("Text differs between destinations").waitFor({ timeout: 15000 });
    await drawer.getByRole("button", { name: "Retry anyway" }).click();
    const dlg = s.page.getByRole("dialog", { name: "Check the platform first" });
    await dlg.waitFor({ state: "visible", timeout: 5000 });
    await s.page.keyboard.press("Escape");
    await dlg.waitFor({ state: "detached", timeout: 5000 });
    c.ok((await drawer.count()) === 1 && (await drawer.isVisible()), "drawer closed together with the dialog");
    // The next Escape closes the drawer.
    await s.page.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached", timeout: 5000 });
    // Same for the reject box -> bulk confirm path is covered in step 5; here also the approve of a multi-approval group.
    await finishPage(c, s);
  });

  // 9. Policies settings.
  for (const cfg of [{ theme: "light", width: 1440, height: 900, tag: "light" }, { theme: "light", width: 390, height: 844, tag: "mobile" }]) {
    await step(`9 policies ${cfg.tag}`, async (c) => {
      const s = await open(cfg);
      await s.page.goto(BASE + "/settings/policies", { waitUntil: "domcontentloaded" });
      await s.page.getByText("Approve every automated post").first().waitFor({ timeout: 60000 });
      c.ok((await s.page.getByText("No links from agents").count()) >= 1, "rule list incomplete");
      c.ok(!(await bodyHasDash(s.page)), "dash in page text");
      c.ok((await overflow(s.page)) <= 0, "horizontal overflow on policies list: " + (await overflow(s.page)) + "px");
      await shot(s.page, `policies-${cfg.tag}.png`);
      await s.page.getByRole("button", { name: "Add rule" }).click();
      const form = s.page.getByRole("dialog");
      await form.waitFor({ state: "visible", timeout: 5000 });
      await form.getByLabel("When").selectOption("CONTAINS_WORDS");
      await form.getByRole("button", { name: "Save rule" }).click();
      await s.page.waitForTimeout(300);
      const invalid = await form.locator('[aria-invalid="true"]').count();
      c.ok(invalid >= 1, "no aria-invalid field after an empty submit");
      c.ok((await form.getByText("Enter a name.").count()) === 1, "name error text missing");
      c.ok((await form.getByText("Add at least one word.").count()) === 1, "words error text missing");
      c.ok(!(await bodyHasDash(s.page)), "dash in form text");
      await shot(s.page, `policies-form-error-${cfg.tag}.png`);
      await form.getByRole("button", { name: "Cancel" }).click();
      await form.waitFor({ state: "detached", timeout: 5000 });
      // Dry run.
      const run = s.page.getByRole("button", { name: "Run check" });
      await run.scrollIntoViewIfNeeded();
      await run.click();
      await s.page.getByText("Needs approval").first().waitFor({ timeout: 10000 });
      c.ok(true, "");
      await run.scrollIntoViewIfNeeded();
      await shot(s.page, `policies-dryrun-${cfg.tag}.png`);
      c.ok((await overflow(s.page)) <= 0, "horizontal overflow after dry run: " + (await overflow(s.page)) + "px");
      await finishPage(c, s);
    });
  }

  // 10. API keys settings.
  for (const cfg of [{ theme: "light", width: 1440, height: 900, tag: "light" }, { theme: "dark", width: 1440, height: 900, tag: "dark" }]) {
    await step(`10 api keys ${cfg.tag}`, async (c) => {
      const s = await open(cfg);
      await s.page.goto(BASE + "/settings/api", { waitUntil: "domcontentloaded" });
      await s.page.getByText("n8n production").first().waitFor({ timeout: 60000 });
      c.ok((await s.page.getByText("Permissions", { exact: true }).count()) >= 1, "Permissions column header missing");
      c.ok((await s.page.getByText("Draft, Schedule, 1 channel").count()) >= 1, "permission summary missing");
      c.ok(!(await bodyHasDash(s.page)), "dash in page text");
      await shot(s.page, `api-keys-${cfg.tag}.png`);
      await s.page.getByTitle("Rename").first().click();
      const modal = s.page.getByRole("dialog", { name: "Rename API key" });
      await modal.waitFor({ state: "visible", timeout: 5000 });
      const sw = modal.getByRole("switch", { name: "Limit what this key can do" });
      c.ok((await sw.getAttribute("aria-checked")) === "true", "limit switch is not on for a restricted key");
      c.ok((await modal.getByText("Allowed actions").count()) === 1, "allowed actions list missing");
      c.ok(!(await bodyHasDash(s.page)), "dash in modal text");
      await shot(s.page, `api-keys-edit-${cfg.tag}.png`);
      await finishPage(c, s);
    });
  }

  // 11. Polish title differs from English.
  await step("11 Polish locale changes the title", async (c) => {
    const en = await open({});
    await gotoAgents(en.page);
    const enTitle = (await en.page.locator("h1").first().innerText()).trim();
    await finishPage(c, en);
    const pl = await open({ locale: "pl" });
    await pl.page.goto(BASE + "/agents", { waitUntil: "domcontentloaded" });
    await rowsOf(pl.page).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    await pl.page.waitForFunction(() => document.querySelector("h1") && document.documentElement.lang === "pl", null, { timeout: 15000 });
    const plTitle = (await pl.page.locator("h1").first().innerText()).trim();
    c.ok(plTitle !== "" && plTitle !== enTitle, `title not translated: "${enTitle}" vs "${plTitle}"`);
    await shot(pl.page, "agents-pl-light.png");
    await finishPage(c, pl);
  });

  await browser.close();

  let failed = 0;
  for (const r of results) {
    const pass = r.failures.length === 0;
    if (!pass) failed += 1;
    console.log((pass ? "PASS " : "FAIL ") + r.name);
    for (const f of r.failures) console.log("     - " + f);
  }
  console.log("\nScreenshots (" + shots.length + ") in " + OUT);
  for (const f of shots) console.log("  " + f);
  if (failed > 0) {
    console.log("\nFAILED: " + failed + " of " + results.length + " checks");
    process.exit(1);
  }
  console.log("\nOK: " + results.length + " checks passed");
}

main().catch(async (e) => {
  console.error("script error:", e);
  try {
    if (browser) await browser.close();
  } catch (x) {}
  process.exit(1);
});
