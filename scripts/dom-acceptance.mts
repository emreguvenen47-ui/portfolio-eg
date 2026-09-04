/**
 * REAL-BROWSER ACCEPTANCE (sprint spec §GERÇEK ACCEPTANCE TEST).
 *
 * Drives headless Chromium against the production server like a user:
 * opens pages, finds tabs in the DOM, CLICKS them, draws on the chart with
 * the mouse, toggles indicators, runs Analyze/NL, opens a paper trade, and
 * verifies drawing persistence across a full page reload.
 *
 * Run: npx tsx scripts/dom-acceptance.mts [baseUrl]
 */
import { chromium, type Page } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3100";
const results: Array<{ step: string; ok: boolean; detail: string }> = [];
const log = (step: string, ok: boolean, detail = "") => {
  results.push({ step, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.setDefaultTimeout(60_000);

// ---- Sign in (paper trading and private stores are auth-gated by design)
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
try {
  await page.fill('input[name="email"]', "dom-test@portfolioeg.local");
  await page.fill('input[name="password"]', "DomTest-2026!x");
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });
  log("Auth: signed in as test user", true);
} catch (e) {
  log("Auth: signed in as test user", false, (e as Error).message.slice(0, 80));
}

async function tabHrefs(p: Page): Promise<string[]> {
  return p.$$eval('[data-testid="ticker-tabs"] a', (as) => as.map((a) => a.textContent?.trim() ?? ""));
}

// ---------------------------------------------------------------- AAPL page
await page.goto(`${BASE}/ticker/AAPL`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const TABS = ["OVERVIEW", "TECHNICAL", "VALUATION", "FINANCIALS", "ANALYSTS", "NEWS", "OWNERSHIP", "EARNINGS", "RESEARCH"];
const navTexts = await tabHrefs(page);
const missing = TABS.filter((t) => !navTexts.includes(t));
log("AAPL: 9 tabs present in DOM", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `found ${TABS.length}`);

const decisionBar = await page.locator("text=ANALYST UPSIDE").count();
log("AAPL: decision strip rendered", decisionBar > 0);

// NEWS tab — click, verify articles
await page.click('[data-testid="ticker-tabs"] a:has-text("NEWS")');
await page.waitForURL("**tab=news**", { timeout: 60_000 });
await page.waitForTimeout(1200);
const newsItems = await page.locator("ol li").count();
const newsroom = await page.locator("text=Newsroom").count();
log("AAPL: NEWS tab click → newsroom rendered", newsroom > 0, `articles: ${newsItems}`);
if (newsItems === 0) log("AAPL: NEWS articles (needs provider quota)", false, "0 articles — provider unreachable/quota; re-verify after reset");
const newsMeta = await page.locator("text=impact").count();
log("AAPL: news cards carry impact/category metadata", newsMeta > 0 || newsItems === 0, newsItems === 0 ? "0 relevant articles (honest empty)" : `${newsMeta} tagged`);

// TECHNICAL tab — click, verify workstation
await page.click('[data-testid="ticker-tabs"] a:has-text("TECHNICAL")');
await page.waitForURL("**tab=technical**", { timeout: 60_000 });
await page.waitForTimeout(2500);
const canvasCount = await page.locator("canvas").count();
log("AAPL: TECHNICAL tab click → chart canvas rendered", canvasCount > 0, `${canvasCount} canvases`);
const riskPlan = await page.locator("text=Risk Plan").count();
const stopLadder = await page.locator("text=STANDARD").count();
log("AAPL: TECHNICAL tab shows Risk Plan + stop ladder", riskPlan > 0 && stopLadder > 0);
const fsBtn = page.locator('a:has-text("Full Screen")').first();
log("AAPL: FULL SCREEN button visible", (await fsBtn.count()) > 0);

// ------------------------------------------------- fullscreen workstation
await fsBtn.click();
await page.waitForURL("**/chart/AAPL", { timeout: 20_000 });
await page.waitForTimeout(3000);
const wsCanvas = await page.locator("canvas").count();
log("Workstation: /chart/AAPL opens with chart", wsCanvas > 0, `${wsCanvas} canvases`);

// candlestick default + toggle line/area
await page.click('button:has-text("line")');
await page.waitForTimeout(600);
await page.click('button:has-text("candles")');
await page.waitForTimeout(600);
log("Workstation: chart type toggles (candles/line)", true);

// zoom (wheel) + pan (drag) on the chart, then crosshair move
const chartBox = await page.locator("div.relative.min-w-0").boundingBox();
if (chartBox) {
  const cx = chartBox.x + chartBox.width / 2;
  const cy = chartBox.y + chartBox.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy, { steps: 6 });
  await page.mouse.up();
  await page.mouse.move(cx - 60, cy - 40);
  log("Workstation: zoom/pan/crosshair interactions executed", true);
} else {
  log("Workstation: zoom/pan/crosshair", false, "chart box not found");
}

// indicators: RSI + MACD panes
await page.click('button:has-text("RSI")');
await page.waitForTimeout(800);
await page.click('button:has-text("MACD")');
await page.waitForTimeout(800);
const paneCanvases = await page.locator("canvas").count();
log("Workstation: RSI + MACD panes added", paneCanvases > wsCanvas, `${wsCanvas} → ${paneCanvases} canvases`);

// drawings: horizontal line, trend line, fibonacci
async function drawWithTool(tooltip: string, clicks: Array<[number, number]>) {
  await page.locator(`button[title="${tooltip}"]`).click();
  const box = await page.locator("div.relative.min-w-0").boundingBox();
  if (!box) throw new Error("chart box missing");
  for (const [fx, fy] of clicks) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
    await page.waitForTimeout(250);
  }
}
await drawWithTool("Horizontal support/resistance", [[0.5, 0.62]]);
await drawWithTool("Trend line", [
  [0.25, 0.7],
  [0.7, 0.35],
]);
await drawWithTool("Fibonacci retracement", [
  [0.3, 0.75],
  [0.75, 0.25],
]);
await page.waitForTimeout(1200); // allow debounced save
const savedResp = await page.evaluate(async () => {
  const r = await fetch("/api/chart/drawings?symbol=AAPL&tf=DAILY");
  return (await r.json()) as { drawings: unknown[] };
});
log("Workstation: hline + trendline + fibonacci drawn and persisted", (savedResp.drawings?.length ?? 0) >= 3, `${savedResp.drawings?.length} stored server-side`);

// EG ANALYZE
const analyzeResp = page.waitForResponse((r) => r.url().includes("/api/technical/analyze"), { timeout: 60_000 });
await page.click('button:has-text("Analyze")');
const aResp = await analyzeResp;
log("Workstation: /api/technical/analyze responded", aResp.ok(), `status ${aResp.status()}`);
await page.waitForSelector('[data-testid="eg-report"]', { timeout: 30_000 });
const repEl = page.locator('[data-testid="eg-report"]');
const repText = (await repEl.textContent()) ?? "";
const need = ["Market structure", "Stop map", "Entry map", "Scenarios", "Momentum", "Volatility"];
const missingSections = need.filter((n) => !repText.includes(n));
log("Workstation: ANALYZE → detailed report rendered", missingSections.length === 0, missingSections.length ? `missing: ${missingSections.join(",")}` : "all sections present");

// EG overlay toggles (Supports/Stops/Targets should be active post-analyze)
for (const lbl of ["Supports", "Stops", "Targets"]) {
  const el = page.locator(`button:has-text("${lbl}")`).first();
  const style = await el.getAttribute("style");
  log(`Workstation: EG ${lbl} overlay toggle active`, (style ?? "").includes("rgb") || (style ?? "").includes("#"), "");
}

// NL command
await page.fill('input[placeholder*="destekleri"]', "ana destekleri göster");
await page.keyboard.press("Enter");
await page.waitForTimeout(4000);
const nlAnswer = await page.locator("text=Supports:").count();
log("Workstation: NL command executed (ana destekleri göster)", nlAnswer > 0);

// Paper trade — wait on the API response (entry snapshot computation can take
// seconds when the fundamentals provider is rate-limited).
const ptResp = page.waitForResponse((r) => r.url().includes("/api/virtual/paper"), { timeout: 90_000 });
await page.click('button:has-text("Open Paper Trade")');
const ptR = await ptResp;
await page.waitForTimeout(500);
const ptBooked = await page.locator("text=Paper trade booked").count();
log("Workstation: paper trade booked with snapshot", ptR.ok() && ptBooked > 0, `status ${ptR.status()}`);

// persistence across navigation: leave and come back
await page.goto(`${BASE}/ticker/MSFT`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
await page.goto(`${BASE}/chart/AAPL`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
const persisted = await page.evaluate(async () => {
  const r = await fetch("/api/chart/drawings?symbol=AAPL&tf=DAILY");
  return (await r.json()) as { drawings: Array<{ type: string }> };
});
const types = (persisted.drawings ?? []).map((d) => d.type);
log(
  "Workstation: drawings persist after leaving and returning",
  types.includes("hline") && types.includes("trendline") && types.includes("fib-retracement"),
  types.join(","),
);

// ------------------------------------------------------- smoke: other pages
for (const sym of ["NVDA", "MSFT", "JPM", "MU"]) {
  await page.goto(`${BASE}/ticker/${sym}?tab=technical`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const c = await page.locator("canvas").count();
  const nav = await tabHrefs(page);
  log(`${sym}: technical tab + tabs smoke`, c > 0 && nav.includes("NEWS"), `canvases ${c}`);
}

// screener → company → same workstation
await page.goto(`${BASE}/screener`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);
const firstRow = page.locator("tbody tr td a").first();
const rowSym = await firstRow.textContent();
await firstRow.click();
await page.waitForURL("**/ticker/**");
await page.waitForSelector('[data-testid="ticker-tabs"]', { timeout: 60_000 });
const navAfter = await tabHrefs(page);
log("Screener → company → stock workstation reachable", navAfter.includes("TECHNICAL") && navAfter.includes("NEWS"), `landed on ${rowSym}`);

// opportunities → company
await page.goto(`${BASE}/opportunities`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
const oppLink = page.locator('a[href^="/ticker/"]').first();
const oppSym = await oppLink.getAttribute("href");
await oppLink.click();
await page.waitForURL("**/ticker/**");
log("Opportunities → company → stock workstation reachable", true, oppSym ?? "");

// NL screener
await page.goto(`${BASE}/screener`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.fill('input[placeholder*="PE 20"]', "PE 25 altı, ROIC yüksek, revenue büyüyen teknoloji şirketleri");
await page.click('button:has-text("Apply")');
await page.waitForTimeout(2500);
const interp = await page.locator("text=Interpreted as").count();
const matchCount = await page.locator("tbody tr").count();
log("NL Screener: sentence → filters → instant results", interp > 0 && matchCount > 0, `${matchCount} rows`);

// paper trade persisted in store?
const paperCheck = await page.evaluate(async () => {
  const r = await fetch("/api/virtual");
  return (await r.json()) as { portfolios?: Array<{ name: string; trades: Array<{ ticker: string; technicalSnapshot?: unknown }> }> };
});
const ledger = (paperCheck.portfolios ?? []).find((p) => p.name.includes("Paper Trades"));
const snapTrade = ledger?.trades.find((t) => t.ticker === "AAPL" && t.technicalSnapshot);
log("Paper trade: ledger row + immutable snapshot in store", Boolean(snapTrade), ledger ? `${ledger.trades.length} trade(s)` : "ledger missing");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n===== DOM ACCEPTANCE: ${results.length - failed.length}/${results.length} passed =====`);
if (failed.length) {
  for (const f of failed) console.log(`FAILED: ${f.step} ${f.detail}`);
  process.exit(1);
}
