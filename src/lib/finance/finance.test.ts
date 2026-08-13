import { describe, expect, it } from "vitest";
import {
  alignSeries,
  beta,
  correlation,
  covarianceMatrix,
  expectedShortfall,
  historicalVaR,
  maxDrawdown,
  portfolioReturns,
  portfolioVolatility,
  quantile,
  riskContributions,
  stdev,
  toReturns,
  weightedAverageVolatility,
} from "./stats";
import {
  breakEvenUsdTryChange,
  ppfScenarios,
  ppfUsdReturn,
  toUsd,
  tryReturnOfUsdAsset,
  usdReturnOfTryAsset,
} from "./fx";

const near = (a: number, b: number, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("FX compounding", () => {
  it("translates a USD asset into TRY multiplicatively", () => {
    // 10% USD gain while USD/TRY rises 25% -> 1.10 * 1.25 - 1 = 37.5%
    near(tryReturnOfUsdAsset(0.1, 0.25), 0.375, 1e-12);
  });

  it("translates a TRY asset into USD by division", () => {
    // The worked example: 100 TRY @40 = $2.50; 135 TRY @50 = $2.70 -> +8%
    near(usdReturnOfTryAsset(0.35, 0.25), 0.08, 1e-12);
  });

  it("round-trips: USD -> TRY -> USD is the identity", () => {
    const rUsd = 0.1234;
    const fx = 0.2871;
    near(usdReturnOfTryAsset(tryReturnOfUsdAsset(rUsd, fx), fx), rUsd, 1e-12);
  });

  it("PPF USD return uses the division form, not subtraction", () => {
    // The naive 35% - 25% = 10% is wrong; the correct answer is 8%.
    const correct = ppfUsdReturn(0.35, 0.25);
    near(correct, 0.08, 1e-12);
    expect(correct).not.toBeCloseTo(0.1, 5);
  });

  it("break-even USD/TRY move equals the TL yield", () => {
    const tl = 0.35;
    near(breakEvenUsdTryChange(tl), 0.35, 1e-12);
    near(ppfUsdReturn(tl, breakEvenUsdTryChange(tl)), 0, 1e-12);
  });

  it("flags USD return risk once depreciation exceeds the yield", () => {
    const s = ppfScenarios(0.35, [0.05, 0.1, 0.2, 0.3, 0.4]);
    expect(s.filter((x) => x.atRisk).map((x) => x.usdTryChange)).toEqual([0.4]);
    expect(s[0].usdReturn).toBeGreaterThan(0);
  });

  it("converts currencies to USD", () => {
    near(toUsd(4820, "TRY", { usdTry: 48.2, eurUsd: 1.17 }), 100, 1e-9);
    near(toUsd(100, "EUR", { usdTry: 48.2, eurUsd: 1.17 }), 117, 1e-9);
    near(toUsd(100, "USD", { usdTry: 48.2, eurUsd: 1.17 }), 100, 1e-9);
  });
});

describe("covariance-based portfolio volatility", () => {
  it("equals the weighted average only when correlation is +1", () => {
    const w = [0.5, 0.5];
    const v = [0.2, 0.3];
    // rho = 1 => sigma_p = 0.5*0.2 + 0.5*0.3 = 0.25
    const covPerfect = [
      [v[0] * v[0], v[0] * v[1]],
      [v[1] * v[0], v[1] * v[1]],
    ];
    near(portfolioVolatility(w, covPerfect), 0.25, 1e-12);
    near(weightedAverageVolatility(w, v), 0.25, 1e-12);
  });

  it("is strictly below the weighted average when correlation < 1", () => {
    const w = [0.5, 0.5];
    const v = [0.2, 0.3];
    const rho = 0.2;
    const cov = [
      [v[0] ** 2, rho * v[0] * v[1]],
      [rho * v[0] * v[1], v[1] ** 2],
    ];
    const sigma = portfolioVolatility(w, cov);
    // sqrt(0.25*0.04 + 0.25*0.09 + 2*0.25*0.2*0.06) = sqrt(0.0385)
    near(sigma, Math.sqrt(0.0385), 1e-12);
    expect(sigma).toBeLessThan(weightedAverageVolatility(w, v));
  });

  it("collapses toward zero for a perfectly hedged pair", () => {
    const w = [0.5, 0.5];
    const v = [0.2, 0.2];
    const cov = [
      [0.04, -0.04],
      [-0.04, 0.04],
    ];
    near(portfolioVolatility(w, cov), 0, 1e-12);
  });

  it("builds a symmetric covariance matrix with variances on the diagonal", () => {
    const a = [0.01, -0.02, 0.015, 0.004, -0.008];
    const b = [0.02, -0.01, 0.005, -0.001, 0.012];
    const m = covarianceMatrix([a, b]);
    near(m[0][1], m[1][0], 1e-15);
    near(m[0][0], stdev(a) ** 2, 1e-15);
  });
});

describe("risk contribution", () => {
  const v = [0.12, 0.32, 0.165];
  const rho = [
    [1, 0.35, 0.2],
    [0.35, 1, 0.4],
    [0.2, 0.4, 1],
  ];
  const cov = v.map((vi, i) => v.map((vj, j) => rho[i][j] * vi * vj));
  const w = [0.35, 0.15, 0.5];

  it("sums to exactly the portfolio volatility (Euler)", () => {
    const { rc, sigma } = riskContributions(w, cov);
    near(
      rc.reduce((a, b) => a + b, 0),
      sigma,
      1e-12,
    );
  });

  it("percentage contributions sum to 1", () => {
    const { pctRc } = riskContributions(w, cov);
    near(
      pctRc.reduce((a, b) => a + b, 0),
      1,
      1e-12,
    );
  });

  it("differs from allocation weight — the whole point of the metric", () => {
    const { pctRc } = riskContributions(w, cov);
    // BIST is 15% of capital but carries much more than 15% of the risk.
    expect(pctRc[1]).toBeGreaterThan(w[1] * 1.3);
    // The low-vol sleeve carries far less risk than its weight implies.
    expect(pctRc[0]).toBeLessThan(w[0]);
  });
});

describe("VaR, expected shortfall and drawdown", () => {
  const returns = Array.from({ length: 500 }, (_, i) => Math.sin(i * 1.7) * 0.01 - 0.0002);

  it("quantile interpolates", () => {
    near(quantile([0, 10], 0.5), 5, 1e-12);
    near(quantile([1, 2, 3, 4], 0), 1, 1e-12);
    near(quantile([1, 2, 3, 4], 1), 4, 1e-12);
  });

  it("VaR is a positive loss magnitude and 99% >= 95%", () => {
    const v95 = historicalVaR(returns, 0.95);
    const v99 = historicalVaR(returns, 0.99);
    expect(v95).toBeGreaterThan(0);
    expect(v99).toBeGreaterThanOrEqual(v95);
  });

  it("expected shortfall is at least VaR", () => {
    expect(expectedShortfall(returns, 0.95)).toBeGreaterThanOrEqual(
      historicalVaR(returns, 0.95) - 1e-12,
    );
  });

  it("returns 0 VaR rather than a bogus number on thin samples", () => {
    expect(historicalVaR([0.01, -0.02, 0.03], 0.95)).toBe(0);
  });

  it("computes peak-to-trough drawdown", () => {
    near(maxDrawdown([100, 120, 60, 90]), 0.5 - 1, 1e-12); // 120 -> 60 = -50%
    near(maxDrawdown([100, 101, 102]), 0, 1e-12);
  });
});

describe("returns, beta and alignment", () => {
  it("converts prices to simple returns", () => {
    const r = toReturns([100, 110, 99]);
    near(r[0], 0.1, 1e-12);
    near(r[1], -0.1, 1e-12);
  });

  it("beta of a series against itself is 1", () => {
    const b = Array.from({ length: 60 }, (_, i) => Math.cos(i) * 0.01);
    near(beta(b, b) as number, 1, 1e-9);
  });

  it("beta of a 2x-levered series is 2", () => {
    const b = Array.from({ length: 60 }, (_, i) => Math.cos(i) * 0.01);
    near(beta(b.map((x) => 2 * x), b) as number, 2, 1e-9);
  });

  it("returns null beta on too little data instead of a garbage number", () => {
    expect(beta([0.01, 0.02], [0.01, 0.02])).toBeNull();
  });

  it("correlation is bounded and exact for identical series", () => {
    const a = [0.01, -0.02, 0.03, 0.005];
    near(correlation(a, a), 1, 1e-12);
    near(correlation(a, a.map((x) => -x)), -1, 1e-12);
  });

  it("aligns series on their common dates only", () => {
    const { dates, prices } = alignSeries([
      {
        key: "A",
        points: [
          { date: "2026-01-01", close: 1 },
          { date: "2026-01-02", close: 2 },
          { date: "2026-01-03", close: 3 },
        ],
      },
      {
        key: "B",
        points: [
          { date: "2026-01-02", close: 10 },
          { date: "2026-01-03", close: 20 },
        ],
      },
    ]);
    expect(dates).toEqual(["2026-01-02", "2026-01-03"]);
    expect(prices[0]).toEqual([2, 3]);
    expect(prices[1]).toEqual([10, 20]);
  });

  it("blends constituent returns at fixed weights", () => {
    const r = portfolioReturns(
      [0.5, 0.5],
      [
        [0.02, -0.01],
        [0.0, 0.03],
      ],
    );
    near(r[0], 0.01, 1e-12);
    near(r[1], 0.01, 1e-12);
  });
});
