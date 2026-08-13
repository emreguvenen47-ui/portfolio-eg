import { NextResponse } from "next/server";
import { parsePortfolioWorkbook } from "@/lib/portfolio/excel";
import { savePortfolioForCaller } from "@/lib/server/user-portfolio";

export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_EXT = /\.(xlsx|xlsm|xls|csv)$/i;

/**
 * Excel import. `preview=1` parses and returns the result WITHOUT applying it,
 * so the UI can show the user exactly what will change before committing.
 */
export async function POST(req: Request) {
  const preview = new URL(req.url).searchParams.get("preview") === "1";

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided under field 'file'" }, { status: 400 });
  }
  if (!ALLOWED_EXT.test(file.name)) {
    return NextResponse.json(
      { error: `Unsupported file type. Expected .xlsx, .xlsm, .xls or .csv — got "${file.name}".` },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File is ${(file.size / 1e6).toFixed(1)}MB; the limit is 8MB.` },
      { status: 413 },
    );
  }

  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const { portfolio } = parsePortfolioWorkbook(buf, file.name);

    if (!preview) await savePortfolioForCaller(portfolio);

    return NextResponse.json({
      applied: !preview,
      meta: portfolio.meta,
      positions: portfolio.positions.map((p) => ({
        code: p.code,
        name: p.name,
        category: p.category,
        weight: p.weight,
        amount: p.amount,
        expectedReturn: p.expectedReturn,
        volatility: p.volatility,
        currency: p.currency,
        currencyCode: p.currencyCode,
        assetClass: p.assetClass,
        region: p.region,
        kind: p.kind,
        symbol: p.symbol,
        isProxy: p.isProxy,
        themes: p.themes,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not parse the workbook" },
      { status: 422 },
    );
  }
}
