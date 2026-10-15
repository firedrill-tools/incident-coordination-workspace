import { test, expect } from "@playwright/test";
import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(".e2e/workspace.json");
const state = () => JSON.parse(readFileSync(file, "utf8"));
test.beforeEach(async ({ page }) => {
  copyFileSync(resolve("../fixtures/starter.json"), file);
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
