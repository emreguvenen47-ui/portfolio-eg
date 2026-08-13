/**
 * Event playbook: scenarios, sensitivity mappings and reaction timelines.
 *
 * All rules, no model. The directional cells below are stated sensitivities —
 * "this exposure has historically moved this way under this condition" — not
 * forecasts, and the UI labels them that way. Anything requiring data we do
 * not have (consensus, previous prints, market-implied probabilities) is left
 * null and renders as N/A; none of it is invented.
 */

export type Direction = "++" | "+" | "0" | "-" | "--";

export type EventKind =
  | "FOMC"
  | "US_CPI"
  | "US_PCE"
  | "US_NFP"
  | "US_GDP"
  | "ECB"
  | "TCMB"
  | "TR_CPI"
  | "EARNINGS";

export type Importance = "HIGH" | "MEDIUM" | "LOW";

export interface Scenario {
  id: string;
  name: string;
  /** What has to happen for this scenario to be the one that occurred. */
  trigger: string;
  whyItMatters: string;
  /** Asset key -> expected direction. Keys match portfolio codes and macro keys. */
  reactions: Record<string, Direction>;
  secondOrder: string[];
}

export interface EventTemplate {
  kind: EventKind;
  title: string;
  importance: Importance;
  /** Markets this event moves first. */
  relevantMarkets: string[];
  /** Portfolio codes with meaningful sensitivity. */
  relevantPositions: string[];
  /** What the market prices going in — null when we have no reliable source. */
  expectationNote: string;
  scenarios: Scenario[];
  timeline: { horizon: string; note: string }[];
}

const T = (horizon: string, note: string) => ({ horizon, note });

/**
 * FOMC.
 *
 * Four scenarios rather than three, because "cut" is not one event: a cut
 * delivered into stable growth and a cut forced by deteriorating data move the
 * same assets in opposite directions after the first session. Collapsing them
 * into one bullish arrow is the single most misleading simplification a rates
 * playbook can make.
 */
const FOMC: EventTemplate = {
  kind: "FOMC",
  title: "FOMC rate decision & press conference",
  importance: "HIGH",
  relevantMarkets: ["US2Y", "US10Y", "DXY", "SPX", "NDX", "XAU/USD"],
  relevantPositions: ["QQQ", "SMH", "RSP", "XLI", "GLDM", "EMXC", "KWEB", "CPER", "SGOV"],
  expectationNote:
    "Fed funds target, consensus and market-implied cut probability are not available on the configured data plan — shown as N/A rather than estimated.",
  scenarios: [
    {
      id: "dovish",
      name: "DOVISH SURPRISE",
      trigger: "Larger cut than priced, or guidance signalling a materially faster easing path.",
      whyItMatters:
        "Lowers the discount rate applied to distant cash flows and eases global dollar funding at the same time. Long-duration equity and non-US assets are the direct beneficiaries.",
      reactions: {
        US2Y: "--",
        US10Y: "-",
        DXY: "-",
        QQQ: "++",
        SMH: "++",
        RSP: "+",
        XLI: "+",
        GLDM: "+",
        EMXC: "+",
        KWEB: "+",
        CPER: "+",
        SGOV: "0",
        BIST: "+",
      },
      secondOrder: [
        "Lower discount rates lift long-duration growth most, so QQQ and SMH lead RSP.",
        "A weaker dollar loosens emerging-market financial conditions, supporting EMXC and KWEB.",
        "If the cut is large enough to read as alarm rather than relief, the initial rally can reverse as growth expectations reset — see the growth-scare scenario.",
        "For a TRY-based reader, a weaker dollar cuts both ways: BIST in USD terms improves, but PPF's carry advantage narrows.",
      ],
    },
    {
      id: "base",
      name: "BASE CASE — AS PRICED",
      trigger: "Decision and guidance land where the market already had them.",
      whyItMatters:
        "The headline is already in the price, so the reaction comes from the detail: the dot plot, the inflation and labour-market language, the balance-sheet plan, and how Powell handles the first three questions.",
      reactions: {
        US2Y: "0",
        US10Y: "0",
        DXY: "0",
        QQQ: "0",
        SMH: "0",
        RSP: "0",
        XLI: "0",
        GLDM: "0",
        EMXC: "0",
        KWEB: "0",
        CPER: "0",
        SGOV: "0",
        BIST: "0",
      },
      secondOrder: [
        "Watch the dot plot's median for the following year rather than this meeting's decision.",
        "Any shift in the characterisation of the labour market usually matters more than the inflation paragraph at this stage of a cycle.",
        "Balance-sheet runoff changes are frequently the real news in an otherwise-priced meeting.",
        "The press conference can fully reverse the decision's initial move; the two are separate events forty-five minutes apart.",
      ],
    },
    {
      id: "hawkish",
      name: "HAWKISH SURPRISE",
      trigger: "No cut when one was priced, or a cut paired with guidance that pushes the path back.",
      whyItMatters:
        "Raises the front end and real yields together. Long-duration equity de-rates, the dollar firms, and non-US and commodity exposures face a tighter funding backdrop.",
      reactions: {
        US2Y: "++",
        US10Y: "+",
        DXY: "+",
        QQQ: "--",
        SMH: "--",
        RSP: "-",
        XLI: "-",
        GLDM: "-",
        EMXC: "-",
        KWEB: "-",
        CPER: "-",
        SGOV: "+",
        BIST: "-",
      },
      secondOrder: [
        "Higher real yields compress the multiple on unprofitable and long-duration growth first.",
        "A firmer dollar tightens emerging-market conditions, which is why EMXC and KWEB tend to lag rather than merely fall with the index.",
        "Short-duration cash instruments hold their value and their carry improves in relative terms.",
        "Gold's response depends on whether the move is in nominal or real yields; a hawkish surprise that lifts real yields is the clearer negative.",
      ],
    },
    {
      id: "growth-scare",
      name: "GROWTH SCARE — BAD CUT",
      trigger: "Aggressive easing delivered because activity or credit data deteriorated sharply.",
      whyItMatters:
        "The same policy action, opposite meaning. Rates fall because the outlook fell. The first-session reaction and the one-month reaction usually point in different directions.",
      reactions: {
        US2Y: "--",
        US10Y: "--",
        DXY: "-",
        QQQ: "-",
        SMH: "-",
        RSP: "--",
        XLI: "--",
        GLDM: "+",
        EMXC: "--",
        KWEB: "-",
        CPER: "--",
        SGOV: "+",
        BIST: "-",
      },
      secondOrder: [
        "Immediately: Treasuries rally, the dollar softens, and long-duration equity can rise on the rate move alone.",
        "Then recession pricing takes over: cyclicals, industrials and copper de-rate on demand rather than on rates.",
        "Equal-weight indices underperform cap-weighted ones because the damage is broad rather than concentrated in a few large names.",
        "Gold and short-duration cash tend to be the portfolio's working hedges in this path.",
      ],
    },
  ],
  timeline: [
    T("First 5 minutes", "Rates and the dollar move on the statement; equity follows the front end."),
    T("First session", "The press conference frequently reverses part or all of the initial move."),
    T("1 week", "Interpretation dominates: was this an easing cycle or a reaction to weakness?"),
    T("1 month", "Growth and earnings consequences matter more than the decision itself."),
  ],
};

const CPI: EventTemplate = {
  kind: "US_CPI",
  title: "US CPI / Core CPI",
  importance: "HIGH",
  relevantMarkets: ["US2Y", "US10Y", "DXY", "SPX", "NDX", "XAU/USD"],
  relevantPositions: ["QQQ", "SMH", "RSP", "XLI", "GLDM", "EMXC", "CPER", "SGOV"],
  expectationNote:
    "Consensus and previous prints are not available on the configured data plan — shown as N/A rather than estimated.",
  scenarios: [
    {
      id: "soft-healthy",
      name: "SOFTER CPI — GROWTH INTACT",
      trigger: "Core below consensus while activity data stays firm.",
      whyItMatters:
        "The combination the market wants: easing policy pressure without an activity cost. Rates fall for the right reason.",
      reactions: {
        US2Y: "-", US10Y: "-", DXY: "-", QQQ: "++", SMH: "++", RSP: "+",
        XLI: "+", GLDM: "+", EMXC: "+", KWEB: "+", CPER: "+", SGOV: "0", BIST: "+",
      },
      secondOrder: [
        "Falling real yields lift long-duration growth most.",
        "A softer dollar supports emerging markets and dollar-priced commodities.",
        "Cyclicals participate here in a way they do not when disinflation comes from weak demand.",
      ],
    },
    {
      id: "soft-demand",
      name: "SOFTER CPI — DEMAND-DRIVEN",
      trigger: "Core below consensus alongside weak retail sales, employment or survey data.",
      whyItMatters:
        "Inflation falling because activity is falling. Rate relief is real, but so is the earnings implication.",
      reactions: {
        US2Y: "--", US10Y: "-", DXY: "-", QQQ: "+", SMH: "0", RSP: "-",
        XLI: "--", GLDM: "+", EMXC: "-", KWEB: "-", CPER: "--", SGOV: "+", BIST: "-",
      },
      secondOrder: [
        "Copper and industrials read the demand signal rather than the rate signal.",
        "Equal-weight underperforms cap-weight as breadth narrows.",
        "This is the case where 'lower CPI is bullish' is simply wrong for most of the book.",
      ],
    },
    {
      id: "hot",
      name: "HOTTER CPI",
      trigger: "Core above consensus, especially in services or shelter.",
      whyItMatters:
        "Pushes the easing path back and lifts real yields. The pressure lands on the longest-duration exposures.",
      reactions: {
        US2Y: "++", US10Y: "+", DXY: "+", QQQ: "--", SMH: "--", RSP: "-",
        XLI: "-", GLDM: "-", EMXC: "-", KWEB: "-", CPER: "0", SGOV: "+", BIST: "-",
      },
      secondOrder: [
        "Gold's reaction is genuinely ambiguous: higher inflation supports it, higher real yields work against it. Which dominates depends on the breakeven move.",
        "Copper can hold up if the inflation is demand-led rather than supply-led.",
        "Short-duration cash gains relative attractiveness immediately.",
      ],
    },
  ],
  timeline: [
    T("First 5 minutes", "Front-end rates and the dollar move first; equity futures follow."),
    T("First session", "Composition matters — services and shelter drive the durable read."),
    T("1 week", "Fed-speak reframes the print into a policy-path expectation."),
    T("1 month", "Only a run of prints in the same direction changes the trend."),
  ],
};

const NFP: EventTemplate = {
  kind: "US_NFP",
  title: "US Nonfarm Payrolls & unemployment",
  importance: "HIGH",
  relevantMarkets: ["US2Y", "US10Y", "DXY", "SPX", "NDX"],
  relevantPositions: ["QQQ", "SMH", "RSP", "XLI", "GLDM", "EMXC", "CPER", "SGOV"],
  expectationNote:
    "Consensus payroll and unemployment forecasts are not available on the configured data plan — shown as N/A.",
  scenarios: [
    {
      id: "goldilocks",
      name: "SOLID BUT NOT HOT",
      trigger: "Payrolls near consensus with contained wage growth.",
      whyItMatters: "Supports the soft-landing path: growth without re-accelerating inflation.",
      reactions: {
        US2Y: "0", US10Y: "0", DXY: "0", QQQ: "+", SMH: "+", RSP: "+",
        XLI: "+", GLDM: "0", EMXC: "+", KWEB: "0", CPER: "+", SGOV: "0", BIST: "0",
      },
      secondOrder: ["Breadth tends to improve, which favours equal-weight over cap-weight."],
    },
    {
      id: "too-hot",
      name: "VERY STRONG",
      trigger: "Large upside surprise, particularly with rising average hourly earnings.",
      whyItMatters: "Removes easing from the path. Good news for the economy, pressure on multiples.",
      reactions: {
        US2Y: "++", US10Y: "+", DXY: "+", QQQ: "-", SMH: "-", RSP: "0",
        XLI: "+", GLDM: "-", EMXC: "-", KWEB: "-", CPER: "+", SGOV: "+", BIST: "-",
      },
      secondOrder: [
        "Cyclicals can rise on the activity read even as growth multiples fall on the rate read — the index move understates the rotation underneath.",
      ],
    },
    {
      id: "weak",
      name: "WEAK",
      trigger: "Meaningful downside miss with unemployment ticking up.",
      whyItMatters: "First read is rate relief; the durability depends on how weak.",
      reactions: {
        US2Y: "-", US10Y: "-", DXY: "-", QQQ: "+", SMH: "0", RSP: "0",
        XLI: "-", GLDM: "+", EMXC: "0", KWEB: "0", CPER: "-", SGOV: "+", BIST: "0",
      },
      secondOrder: ["Watch whether the equity rally holds into the following session — that is the tell."],
    },
    {
      id: "very-weak",
      name: "VERY WEAK",
      trigger: "Large miss, negative revisions, and a clear rise in the unemployment rate.",
      whyItMatters: "Recession pricing overrides rate relief.",
      reactions: {
        US2Y: "--", US10Y: "--", DXY: "-", QQQ: "-", SMH: "-", RSP: "--",
        XLI: "--", GLDM: "+", EMXC: "--", KWEB: "-", CPER: "--", SGOV: "+", BIST: "-",
      },
      secondOrder: [
        "The nonlinearity is the point: moderately weak is bullish, very weak is not.",
        "Equal-weight and industrials carry the damage; gold and short-duration cash are the hedges.",
      ],
    },
  ],
  timeline: [
    T("First 5 minutes", "Front end and dollar react to the headline and the wage line."),
    T("First session", "Revisions to prior months often matter as much as the headline."),
    T("1 week", "The print is folded into the policy-path expectation."),
    T("1 month", "Only the trend in the unemployment rate carries."),
  ],
};

const TCMB: EventTemplate = {
  kind: "TCMB",
  title: "TCMB rate decision",
  importance: "HIGH",
  relevantMarkets: ["USD/TRY", "XU100"],
  relevantPositions: ["BIST", "PPF", "GLDM"],
  expectationNote:
    "TCMB policy rate, consensus and the current TL deposit curve are not available on the configured data plan — shown as N/A.",
  scenarios: [
    {
      id: "as-priced",
      name: "CUT AS PRICED",
      trigger: "Policy rate moves to where the market already had it, guidance unchanged.",
      whyItMatters: "Already in the price; the reaction comes from the accompanying language.",
      reactions: { "USD/TRY": "0", BIST: "0", PPF: "0", GLDM: "0", XU100: "0" },
      secondOrder: [
        "Separate TL and USD returns: an unchanged BIST in TL terms is a loss in USD if the lira slips.",
      ],
    },
    {
      id: "dovish",
      name: "LARGE / DOVISH CUT",
      trigger: "Cut bigger than priced, or guidance pointing to faster easing.",
      whyItMatters:
        "Lower TL rates support domestic equity in local terms while reducing the carry that makes the money-market fund attractive, and raise depreciation risk.",
      reactions: { "USD/TRY": "+", BIST: "+", PPF: "-", GLDM: "+", XU100: "+" },
      secondOrder: [
        "BIST can rally in TL and still fall in USD — which return matters depends on the base currency of the book.",
        "PPF's forward carry falls immediately even though its TL value does not.",
        "Banks and domestic cyclicals are usually the first beneficiaries in local terms.",
      ],
    },
    {
      id: "hawkish-hold",
      name: "HAWKISH HOLD",
      trigger: "No cut when one was expected, or explicit commitment to tight policy.",
      whyItMatters: "Supports the lira and preserves real carry at the cost of delaying a domestic re-rating.",
      reactions: { "USD/TRY": "-", BIST: "-", PPF: "+", GLDM: "0", XU100: "-" },
      secondOrder: [
        "A stable lira improves BIST's USD return even when the index falls in TL.",
        "PPF's real carry stays attractive, which is the point of holding it.",
      ],
    },
    {
      id: "credibility",
      name: "POLICY CREDIBILITY SHOCK",
      trigger: "Abrupt policy reversal, leadership change, or a move that breaks the stated framework.",
      whyItMatters: "The currency reprices faster than domestic equity can adjust.",
      reactions: { "USD/TRY": "++", BIST: "--", PPF: "--", GLDM: "++", XU100: "-" },
      secondOrder: [
        "In USD terms this is the worst case for both Turkish sleeves at once.",
        "Gold and dollar assets are the portfolio's hedge against exactly this path.",
        "TL and USD returns diverge most sharply here — read them separately.",
      ],
    },
  ],
  timeline: [
    T("First 5 minutes", "USD/TRY moves first; the equity index lags."),
    T("First session", "The statement's framework language carries more than the level."),
    T("1 week", "Deposit and swap rates reveal whether the market believes the guidance."),
    T("1 month", "Inflation prints decide whether the policy stance was credible."),
  ],
};

export const TEMPLATES: Record<EventKind, EventTemplate> = {
  FOMC,
  US_CPI: CPI,
  US_PCE: { ...CPI, kind: "US_PCE", title: "US PCE / Core PCE" },
  US_NFP: NFP,
  US_GDP: { ...NFP, kind: "US_GDP", title: "US GDP", importance: "MEDIUM" },
  ECB: { ...FOMC, kind: "ECB", title: "ECB rate decision", relevantPositions: ["VGK", "EMXC", "GLDM"] },
  TCMB,
  TR_CPI: {
    ...TCMB,
    kind: "TR_CPI",
    title: "Turkey CPI",
    scenarios: TCMB.scenarios.map((s) => ({ ...s })),
  },
  EARNINGS: {
    kind: "EARNINGS",
    title: "Major earnings",
    importance: "MEDIUM",
    relevantMarkets: ["SPX", "NDX"],
    relevantPositions: ["QQQ", "SMH", "RSP", "XLI"],
    expectationNote:
      "Consensus EPS and revenue, analyst targets and options-implied moves are not available on the configured data plan. Reported EPS vs consensus for past quarters is shown on each ticker page.",
    scenarios: [
      {
        id: "beat-raise",
        name: "BEAT + RAISE",
        trigger: "Reported above consensus and forward guidance lifted.",
        whyItMatters: "Guidance moves the forward estimate, which is what the multiple is applied to.",
        reactions: { QQQ: "+", SMH: "+", RSP: "0", XLI: "0" },
        secondOrder: ["A single mega-cap beat can lift the cap-weighted index without improving breadth."],
      },
      {
        id: "beat-weak-guide",
        name: "BEAT + WEAK GUIDANCE",
        trigger: "Reported above consensus but the outlook is cut.",
        whyItMatters: "The reported quarter is history; the guide is the input to next year's estimate.",
        reactions: { QQQ: "-", SMH: "-", RSP: "0", XLI: "0" },
        secondOrder: ["This is the case where the headline beat and the share price disagree."],
      },
      {
        id: "miss-maintain",
        name: "MISS + MAINTAIN",
        trigger: "Below consensus but the full-year outlook is unchanged.",
        whyItMatters: "Often read as timing rather than deterioration.",
        reactions: { QQQ: "0", SMH: "0", RSP: "0", XLI: "0" },
        secondOrder: ["Reaction usually depends on whether management explains the shortfall credibly."],
      },
      {
        id: "miss-cut",
        name: "MISS + CUT GUIDANCE",
        trigger: "Below consensus and the outlook is cut.",
        whyItMatters: "Both the current and forward estimate move down together.",
        reactions: { QQQ: "--", SMH: "--", RSP: "-", XLI: "-" },
        secondOrder: ["Sector read-across is usually larger than the single name's index weight."],
      },
    ],
    timeline: [
      T("First 5 minutes", "The headline EPS number moves the stock before anyone reads the guide."),
      T("First session", "The call, not the release, sets the direction that holds."),
      T("1 week", "Analyst revisions land and the forward estimate resets."),
      T("1 month", "Sector read-across matters more than the original print."),
    ],
  },
};

/** Portfolio codes that carry meaningful sensitivity to each macro driver. */
export const MACRO_SENSITIVITY: {
  driver: string;
  note: string;
  positions: { code: string; direction: Direction; why: string }[];
}[] = [
  {
    driver: "Rising real yields",
    note: "Discount-rate channel. Hits the longest-duration cash flows first.",
    positions: [
      { code: "QQQ", direction: "--", why: "Long-duration mega-cap growth" },
      { code: "SMH", direction: "--", why: "Highest-duration cyclical growth" },
      { code: "GLDM", direction: "-", why: "Non-yielding asset competes with real yields" },
      { code: "SGOV", direction: "+", why: "Reinvests at the higher rate" },
    ],
  },
  {
    driver: "Stronger dollar (DXY up)",
    note: "Funding-conditions channel for non-US and commodity exposure.",
    positions: [
      { code: "EMXC", direction: "--", why: "EM financial conditions tighten" },
      { code: "KWEB", direction: "-", why: "China tech sensitive to global liquidity" },
      { code: "CPER", direction: "-", why: "Dollar-priced commodity" },
      { code: "GLDM", direction: "-", why: "Dollar-priced commodity" },
      { code: "VGK", direction: "-", why: "Translation and conditions" },
    ],
  },
  {
    driver: "China / global growth",
    note: "Demand channel for industrial metals and EM equity.",
    positions: [
      { code: "CPER", direction: "++", why: "Copper demand is China-weighted" },
      { code: "KWEB", direction: "++", why: "Direct China exposure" },
      { code: "EMXC", direction: "+", why: "EM ex-China still tracks the cycle" },
      { code: "XLI", direction: "+", why: "Global industrial demand" },
    ],
  },
  {
    driver: "Geopolitical / fiscal stress",
    note: "Haven channel.",
    positions: [
      { code: "GLDM", direction: "++", why: "Primary haven in the book" },
      { code: "SGOV", direction: "+", why: "Short duration, low credit risk" },
      { code: "RSP", direction: "-", why: "Broad equity beta" },
    ],
  },
  {
    driver: "TCMB policy & Turkish inflation",
    note: "Read TL and USD returns separately — they can point opposite ways.",
    positions: [
      { code: "BIST", direction: "+", why: "Local rate cuts support local equity in TL" },
      { code: "PPF", direction: "--", why: "Forward carry falls as policy rates fall" },
      { code: "GLDM", direction: "+", why: "Hedge against lira depreciation" },
    ],
  },
];

export const DIRECTION_LABEL: Record<Direction, string> = {
  "++": "strongly positive sensitivity",
  "+": "positive sensitivity",
  "0": "little direct sensitivity",
  "-": "negative sensitivity",
  "--": "strongly negative sensitivity",
};

export const DIRECTION_WEIGHT: Record<Direction, number> = {
  "++": 2,
  "+": 1,
  "0": 0,
  "-": -1,
  "--": -2,
};
