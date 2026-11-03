// Temporary real-browser Stage 3 audit. This does not create any real posts.
const { chromium } = require(process.env.QA_PLAYWRIGHT_DIR || "playwright");
const fs = require("node:fs");
const path = require("node:path");
const BASE = process.env.QA_URL || "http://127.0.0.1:4200";
const WIDTHS = [320, 360, 375, 430, 768, 1024, 1440];
const OUTPUT = "stage3-visual-results";
fs.mkdirSync(OUTPUT, { recursive: true });

const testUser = {
  id: "stage3-test-user",
  name: "Alex",
  email: "stage3@example.test",
  orgId: "stage3-test-org",
  totalChannels: 0,
  tier: "STANDARD",
  role: "ADMIN",
  isLifetime: false,
  admin: false,
  impersonate: false,
  isTrailing: false,
  allowTrial: true,
  onTrial: true,
  trialDaysLeft: 7,
  publicApi: "https://api.postsider.com",
  isPlatformAi: false,
  aiUsage: null,
};

const channel = {
  id: "stage3-test-channel",
  internalId: "stage3-internal",
  name: "Test channel",
  identifier: "x",
  picture: null,
  disabled: false,
  refreshNeeded: false,
  inBetweenSteps: false,
  display: null,
  type: "x",
  time: [{ time: 120 }, { time: 400 }, { time: 700 }],
  changeProfilePicture: false,
  changeNickName: false,
  customer: null,
  additionalSettings: "{}",
  editor: "",
  stripLinks: false,
  isCustomFields: false,
};

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function installApiMock(context, counters) {
  await context.route(/http:\/\/(127\.0\.0\.1|localhost):3000\/.*/, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pathname = url.pathname;
    if (req.method() !== "GET" && req.method() !== "OPTIONS") {
      counters.writes.push({ method: req.method(), pathname });
    }
    const headers = {
      "access-control-allow-origin": BASE,
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "content-type,auth,showorg,authorization",
      "access-control-allow-methods": "GET,POST,OPTIONS,PUT,DELETE,PATCH",
      "content-type": "application/json",
    };
    if (req.method() === "OPTIONS") {
      await route.fulfill({status:204,headers});
      return;
    }
    let response;
    if (pathname === "/user/self") response = testUser;
    else if (pathname === "/user/organizations") response = [];
    else if (pathname === "/integrations/list") response = {
      integrations: counters.connected ? [channel] : []
    };
    else if (pathname === "/settings/api-keys") response = [
      {id:"stage3-test-key",name:"test-only",key:"ps_masked",createdAt:"2026-11-03T00:00:00Z"}
    ];
    else if (pathname === "/posts/list") response = {
      p: [],t: counters.drafts ? 1 : 0,pg: 0,l: 1,hm: false
    };
    else if (pathname === "/posts/stage3-draft-123") response = {
      posts: [{
        id: "stage3-draft-123",
        group: "stage3-group",
        state: counters.drafts ? "DRAFT" : "PUBLISHED",
        integrationId: "stage3-test-channel",
        content: "One harmless test draft",
      }],
    };
    else if (pathname === "/posts") response = {p: []};
    else if (pathname === "/integrations") response = { integrations: [] };
    else response = {};
    await route.fulfill({
      status:200,headers,body:JSON.stringify(response)
    });
  });
}

async function inspectWidth(browser, width) {
  const context=await browser.newContext({
    viewport:{width,height:width<=430?820:960},
    deviceScaleFactor:1,
    permissions:["clipboard-read","clipboard-write"],
    reducedMotion:"reduce",
  });
  const counters={connected: false, drafts: false, writes:[]};
  await installApiMock(context,counters);
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror", e=>errors.push(e.message));
  const result={width};
  try {
    await page.goto(BASE+"/onboarding",{waitUntil:"domcontentloaded",timeout:100000});
    await page.getByRole("heading",{name:"What are you using PostSider for?"}).waitFor({timeout:25000});
    result.choiceWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    result.choiceVisible=await page.getByRole("button",{name:/AI agents & automation/}).isVisible();
    if([320,375,1440].includes(width)){
      await page.screenshot({path:path.join(OUTPUT,"choice-"+width+".png"),fullPage:true,animations:"disabled"});
    }

    await page.getByRole("button",{name:/AI agents & automation/}).click();
    await page.getByRole("heading",{name:/Connect your agent/}).waitFor({timeout:10000});
    await page.getByText("No accounts connected yet").waitFor({timeout:10000});
    result.agentWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
    result.agentSteps=await page.locator("section[aria-labelledby^='agent-']").count();

    await page.getByRole("button",{name:"Local MCP"}).click();
    const local=await page.locator("#agent-connection").locator("xpath=..").locator("pre code").first().textContent();
    result.localHasPackage=local.includes("@postsider/mcp");
    result.localHasPlaceholder=local.includes("YOUR_API_KEY");
    result.localHasEndpoint=local.includes("POSTSIDER_API_URL");

    await page.getByRole("button",{name:"REST API"}).click();
    const rest=await page.locator("#agent-connection").locator("xpath=..").locator("pre code").first().textContent();
    result.rawAuth=rest.includes("Authorization: $POSTSIDER_API_KEY");
    result.noBearerAuth=!rest.includes("Authorization: Bearer");

    await page.getByRole("button",{name:"Hosted MCP"}).click();
    await page.getByRole("button",{name:"Codex"}).click();
    const codex=await page.locator("#agent-connection").locator("xpath=..").locator("pre code").first().textContent();
    result.codexConfig=codex.includes("codex mcp add postsider --url");

    await page.locator("section[aria-labelledby='agent-connection']").getByRole("button",{name:"Copy code"}).click();
    result.clipboard=await page.evaluate(async()=>navigator.clipboard.readText()).catch(()=>"");
    result.copyWorked=result.clipboard===codex;

    result.initialFinishDisabled=await page.getByRole("button",{name:"Finish AI setup"}).isDisabled();
    if([320,375,768,1440].includes(width)){
      await page.screenshot({path:path.join(OUTPUT,"agent-"+width+".png"),fullPage:true,animations:"disabled"});
      if([375,1440].includes(width)) await page.screenshot({path:path.join(OUTPUT,"agent-fold-"+width+".png"),animations:"disabled"});
    }

    // Read-only mock status changes represent a channel and draft now visible.
    // This verifies the UI gating; no API publishing call is ever made.
    counters.connected=true;
    counters.drafts=true;
    await page.getByRole("button",{name:"Refresh workspace status"}).click();
    await page.getByText("1 draft(s) currently visible in the workspace").waitFor({timeout:10000});
    result.beforeConfirmDisabled=await page.getByRole("button",{name:"Finish AI setup"}).isDisabled();
    await page.getByRole("checkbox",{name:/I checked the response in my client/}).check();
    result.finishBeforeId=await page.getByRole("button",{name:"Finish AI setup"}).isEnabled();
    await page.getByRole("textbox",{name:"Post ID returned by your agent"}).fill("unknown-post-123");
    await page.getByRole("button",{name:"Verify this draft"}).click();
    await page.getByText(/could not be verified as a draft/).waitFor({timeout:10000});
    result.unknownDraftBlocked=await page.getByRole("button",{name:"Finish AI setup"}).isDisabled();
    await page.getByRole("textbox",{name:"Post ID returned by your agent"}).fill("stage3-draft-123");
    await page.getByRole("button",{name:"Verify this draft"}).click();
    await page.getByText(/Verified: this ID is a saved draft/).waitFor({timeout:10000});
    result.finishEnabled=await page.getByRole("button",{name:"Finish AI setup"}).isEnabled();

    // On a selected viewport, verify the real Calendar resume affordance.
    if(width===375){
      await page.getByRole("button",{name:"Continue later in the dashboard"}).click();
      await page.waitForURL(/\/calendar/,{timeout:20000});
      await page.getByRole("heading",{name:"Finish your AI agent setup"}).waitFor({timeout:15000});
      result.calendarBanner=true;
      await page.getByRole("link",{name:"Continue setup"}).click();
      await page.getByRole("heading",{name:/Connect your agent/}).waitFor({timeout:10000});
      result.resumeViaBanner=true;
    }
    // Revisit an unfinished agent setup after a simulated OAuth return.
    await page.reload({waitUntil:"domcontentloaded"});
    await page.getByRole("heading",{name:"What are you using PostSider for?"}).waitFor();
    await page.goto(BASE+"/onboarding?flow=agents",{waitUntil:"domcontentloaded"});
    await page.getByRole("heading",{name:/Connect your agent/}).waitFor({timeout:10000});
    result.resumeAgent=true;
    result.writes=counters.writes;

  } catch(e) {
    result.error=String(e);
  }
  result.errors=errors;
  await context.close();
  return result;
}

async function socialPath(browser) {
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const counters={connected:false,drafts:false,writes:[]};
  await installApiMock(context,counters);
  const page=await context.newPage();
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  const output={};
  try {
    await page.goto(BASE+"/onboarding",{waitUntil:"domcontentloaded",timeout:100000});
    await page.getByRole("heading",{name:"What are you using PostSider for?"}).waitFor({timeout:25000});
    await page.getByRole("button",{name:/Social media management/}).click();
    await page.getByRole("heading",{name:/Welcome/}).waitFor({timeout:10000});
    output.welcome=true;
    await page.getByRole("button",{name:"Let's go"}).click();
    await page.getByRole("heading",{name:"Connect your first channel"}).waitFor({timeout:10000});
    output.connect=true;
    const progress=await page.evaluate(()=>document.documentElement.scrollWidth);
    output.overflow=progress>390;
    // Keep channel OAuth untouched: existing handoff to calendar?connect=1
    await page.getByRole("button",{name:"Let's publish your content"}).click();
    await page.waitForURL(/\/calendar/,{timeout:20000});
    output.calendarHandoff=true;
    output.completion=await page.evaluate(()=>{
      const raw=localStorage.getItem("postsider:onboarding:v3:stage3-test-user:stage3-test-org");
      return raw?JSON.parse(raw):null;
    });
    output.writes=counters.writes;
  } catch(e) {output.error=String(e);}
  output.errors=errors;
  await context.close();
  return output;
}

(async()=>{
  const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
  const widths=[];
  for(const width of WIDTHS) widths.push(await inspectWidth(browser,width));
  const social=await socialPath(browser);
  const failures=[];
  for(const x of widths){
    if(x.error) failures.push(x.width+": "+x.error);
    if(x.choiceWidth>x.width+2)failures.push(x.width+": choice horizontal overflow "+x.choiceWidth);
    if(x.agentWidth>x.width+2)failures.push(x.width+": agent horizontal overflow "+x.agentWidth);
    if(!x.choiceVisible||!x.localHasPackage||!x.localHasPlaceholder||!x.localHasEndpoint||
        !x.rawAuth||!x.noBearerAuth||!x.codexConfig||!x.copyWorked||
        !x.initialFinishDisabled||!x.beforeConfirmDisabled||x.finishBeforeId||!x.unknownDraftBlocked||!x.finishEnabled||!x.resumeAgent||(x.width===375&&(!x.calendarBanner||!x.resumeViaBanner))){
      failures.push(x.width+": onboarding interaction failed");
    }
    if(x.writes?.length) failures.push(x.width+": unexpected backend mutation "+JSON.stringify(x.writes));
    if(x.errors?.length) failures.push(x.width+": runtime errors "+JSON.stringify(x.errors).slice(0,300));
  }
  if(social.error||!social.welcome||!social.connect||social.overflow||
      !social.calendarHandoff||social.completion?.intent!=="social"||
      social.completion?.completed!==true) failures.push("social path failed: "+JSON.stringify(social).slice(0,600));
  if(social.writes?.length)failures.push("social path triggered unexpected backend write");
  fs.writeFileSync(path.join(OUTPUT,"report.json"),JSON.stringify({widths,social,failures},null,2));
  console.log(JSON.stringify({widths:widths.map(x=>({width:x.width,choiceWidth:x.choiceWidth,agentWidth:x.agentWidth,copyWorked:x.copyWorked,finishEnabled:x.finishEnabled,resumeAgent:x.resumeAgent,error:x.error})),social,failures},null,2));
  await browser.close();
  if(failures.length)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
