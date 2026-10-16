import { test, expect } from "@playwright/test";
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = () => readFileSync(resolve(".e2e/workspace-path.txt"), "utf8");
const state = () => JSON.parse(readFileSync(file(), "utf8"));
test.beforeEach(async ({ page, request }) => {
  expect((await request.post("http://127.0.0.1:3826/__test/reset")).ok()).toBe(true);
  await page.route(/^https?:/, route => ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
});

test("chat streams a real tool proposal, renders math and commits only after commander approval", async ({ page }, testInfo) => {
  await page.goto("/");
  const input = page.locator(".chat-wrap textarea");
  await input.fill("Read the incident and propose an evidence-backed escalation.");
  await input.press("Enter");
  await expect(page.getByText(/Draft PROP-1 awaits incident commander approval/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve update" })).toBeEnabled();
  expect(state().incident.status).toBe("investigating");
  expect(state().slack_posts).toEqual([]);
  const formula = page.locator(".chat-wrap .katex");
  await expect(formula).toBeVisible();
  await expect(formula.locator("mfrac")).toHaveCount(1);
  await expect(formula.locator(".katex-html")).toHaveCSS("white-space", "nowrap");
  await expect(page.locator(".chat-wrap script, .chat-wrap a[href^='javascript:']")).toHaveCount(0);
  expect(await page.evaluate(() => "syntheticUnsafe" in window)).toBe(false);
  await page.getByRole("button", { name: "Approve update" }).click();
  await expect(page.locator(".hero-status strong")).toHaveText("escalated");
  expect(state().incident.owner).toBe("Nora");
  expect(state().slack_posts).toHaveLength(1);
  await expect(page.locator(".posts")).toContainText("OBS-1");
  await page.screenshot({ path: testInfo.outputPath("chat-and-approved-state.png"), fullPage: true });
});

test("a streamed provider error stays visible and a later request can recover without committing", async ({ page }) => {
  await page.goto("/");
  const before = state();
  const input = page.locator(".chat-wrap textarea");
  await input.fill("fail-provider: inspect the incident");
  await input.press("Enter");
  await expect(page.locator(".chat-wrap")).toContainText(/could not complete this request/i);
  await expect(page.getByRole("button", { name: "Approve update" })).toHaveCount(0);
  expect(state()).toEqual(before);
  await input.fill("Inspect again and propose an evidence-backed escalation.");
  await input.press("Enter");
  await expect(page.getByText(/Draft PROP-1 awaits incident commander approval/)).toBeVisible();
  await expect(page.locator(".chat-wrap [role='alert']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve update" })).toBeEnabled();
  expect(state().proposals).toHaveLength(1);
  expect(state().incident).toEqual(before.incident);
  expect(state().slack_posts).toEqual([]);
});

test("an unavailable API disables decisions and synthetic telemetry writes", async ({ page }) => {
  await page.goto("/"); const input = page.locator(".chat-wrap textarea");
  await input.fill("Propose an evidence-backed escalation."); await input.press("Enter");
  await expect(page.getByRole("button", { name: "Approve update" })).toBeEnabled();
  await page.route("http://127.0.0.1:3826/workspace", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
  await expect(page.locator(".container > [role=alert]")).toContainText(/API unavailable/i);
  await expect(page.getByRole("button", { name: "Approve update" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Simulate healthy metrics" })).toBeDisabled();
});
test("read recovery clears only the unavailable-read error", async ({ page }) => {
  let reads = 0;
  await page.route("http://127.0.0.1:3826/workspace", route => { reads++; return reads === 1 ? route.fulfill({ status: 503, contentType: "application/json", body: '{}' }) : route.continue(); });
  await page.goto("/"); await expect(page.locator(".container > [role=alert]")).toContainText(/API unavailable/i);
  await expect(page.getByText("checkout-api", { exact: true })).toBeVisible();
  await expect(page.locator(".container > [role=alert]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Simulate healthy metrics" })).toBeEnabled();
});
test("initial source failure does not invent an active incident identity", async ({ page }) => {
  await page.route("http://127.0.0.1:3826/workspace", route => route.fulfill({ status: 503, contentType: "application/json", body: '{}' }));
  await page.goto("/"); await expect(page.locator(".container > [role=alert]")).toContainText(/API unavailable/i);
  await expect(page.locator(".hero h1")).toHaveText("Incident unavailable");
  await expect(page.getByRole("button", { name: "Simulate healthy metrics" })).toBeDisabled();
});

test("commander validation remains visible across reads and a separate rejection clears the queue",async({page})=>{
 await page.goto('/');const input=page.locator('.chat-wrap textarea');await input.fill('Propose escalation with current evidence');await input.press('Enter');await expect(page.getByRole('button',{name:'Approve update'})).toBeEnabled();
 await page.getByLabel('Incident commander',{exact:true}).fill('Agent');await page.getByRole('button',{name:'Approve update'}).click();
 await expect(page.locator('.container > [role=alert]')).toContainText(/current incident commander's name/);await page.waitForTimeout(3200);await expect(page.locator('.container > [role=alert]')).toBeVisible();
 expect(state().slack_posts).toHaveLength(0);await page.getByLabel('Incident commander',{exact:true}).fill('Morgan');await page.getByRole('button',{name:'Reject',exact:true}).click();
 await expect(page.getByRole('button',{name:'Approve update'})).toHaveCount(0);expect(state().proposals[0].decision).toBe('rejected');expect(state().updates).toHaveLength(0);await expect(page.locator('.container > [role=alert]')).toHaveCount(0);
});
test("changed telemetry stops stale approval but the commander can reject it",async({page})=>{
 await page.goto('/');const input=page.locator('.chat-wrap textarea');await input.fill('Propose an escalation');await input.press('Enter');await expect(page.getByRole('button',{name:'Approve update'})).toBeEnabled();
 await page.getByRole('button',{name:'Simulate healthy metrics'}).click();await expect(page.locator('.metrics .good')).toHaveText('healthy');
 await page.getByRole('button',{name:'Approve update'}).click();await expect(page.locator('.container > [role=alert]')).toContainText(/evidence changed/);expect(state().updates).toHaveLength(0);
 await page.getByRole('button',{name:'Reject',exact:true}).click();await expect(page.getByRole('button',{name:'Approve update'})).toHaveCount(0);expect(state().slack_posts).toHaveLength(0);
});
test("a late stale poll cannot replace confirmed telemetry",async({page})=>{
 await page.goto('/');await expect(page.getByText('checkout-api',{exact:true})).toBeVisible();const original=state();let held=false,release!:()=>void;
 const hold=new Promise<void>(r=>{release=r;});let reads=0;
 await page.route('http://127.0.0.1:3826/workspace',async route=>{reads++;if(reads===1){held=true;await hold;try{await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(original)});}catch{}}else await route.continue();});
 await expect.poll(()=>held).toBe(true);await page.getByRole('button',{name:'Simulate healthy metrics'}).click();await expect(page.locator('.metrics .good')).toHaveText('healthy');release();
 await page.waitForTimeout(300);await expect(page.locator('.metrics .good')).toHaveText('healthy');expect(state().observations).toHaveLength(3);
});
test("Stop cancels real pending native HTTP and a fresh request recovers",async({page,request})=>{
 await page.goto('/');const input=page.locator('.chat-wrap textarea');await input.fill('hold-provider: inspect the incident');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect.poll(async()=> (await (await request.get('http://127.0.0.1:3826/__test/pending')).json()).pending).toBe(true);
 await page.getByRole('button',{name:'Stop message',exact:true}).click();await expect.poll(async()=> (await (await request.get('http://127.0.0.1:3826/__test/pending')).json()).drained).toBe(true);
 expect(state().proposals).toHaveLength(0);await input.fill('Inspect current evidence and propose escalation');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByRole('button',{name:'Approve update'})).toBeEnabled();expect(state().slack_posts).toHaveLength(0);
});
test("unfinished native response shows an error without a proposal and later recovery succeeds",async({page})=>{
 await page.goto('/');const input=page.locator('.chat-wrap textarea');await input.fill('truncated-provider: propose escalation');await input.press('Enter');await expect(page.locator('.chat-wrap')).toContainText(/could not complete this request/i);expect(state().proposals).toHaveLength(0);
 await input.fill('Propose escalation from current evidence');await input.press('Enter');await expect(page.getByRole('button',{name:'Approve update'})).toBeEnabled();expect(state().updates).toHaveLength(0);
});
test("busy queue search approves one reviewed update and preserves unrelated imported records",async({page,request},testInfo)=>{
 expect((await request.post('http://127.0.0.1:3826/__test/reset?case=busy-incident')).ok()).toBe(true);const before=state();await page.goto('/');await page.getByLabel('Search review queue').fill('PROP-80');await expect(page.getByRole('button',{name:'Approve update'})).toHaveCount(1);
 const selected=before.proposals.find((p:any)=>p.id==='PROP-80');await page.getByRole('button',{name:'Approve update'}).click();await expect.poll(()=>state().updates.length).toBe(65);const after=state();
 expect(after.incident.owner).toBe(selected.owner);expect(after.slack_posts.slice(0,64)).toEqual(before.slack_posts);expect(after.proposals.filter((p:any)=>p.id!=='PROP-80')).toEqual(before.proposals.filter((p:any)=>p.id!=='PROP-80'));
 await page.screenshot({path:testInfo.outputPath('busy-reviewed-incident.png'),fullPage:true});
});
test("alternate commander/channel and hostile report render actual source safely",async({page,request})=>{
 expect((await request.post('http://127.0.0.1:3826/__test/reset?case=ownership-handoff')).ok()).toBe(true);await page.goto('/');await expect(page.locator('.hero h1')).toHaveText('Payment confirmation latency');await expect(page.getByLabel('Incident commander',{exact:true})).toHaveValue('Avery');await expect(page.locator('.channel h2')).toHaveText('#inc-payments');
 const input=page.locator('.chat-wrap textarea');await input.fill('Propose an escalation to Omar citing OBS-1');await input.press('Enter');await expect(page.getByRole('button',{name:'Approve update'})).toBeEnabled();await page.getByRole('button',{name:'Approve update'}).click();await expect.poll(()=>state().updates.length).toBe(1);expect(state().slack_posts[0].channel).toBe('#inc-payments');expect(state().proposals[0].actor).toBe('Avery');
 expect((await request.post('http://127.0.0.1:3826/__test/reset?case=hostile-report')).ok()).toBe(true);await page.reload();await expect(page.locator('.observation').filter({hasText:'window.incidentInjected'})).toBeVisible();expect(await page.evaluate(()=> 'incidentInjected' in window)).toBe(false);await expect(page.locator('.observation script')).toHaveCount(0);
});
