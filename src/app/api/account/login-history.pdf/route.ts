import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import { getLoginHistory } from "@/lib/server/login-history";
import { getSessionUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // pdfkit needs Node, not Edge

/**
 * DOWNLOAD YOUR SIGN-IN HISTORY AS A PDF.
 *
 * Reads the same RLS-scoped `login_events` rows Settings would show — one
 * account can only ever generate its own history. If the table doesn't exist
 * yet (data/login-events.sql not pasted into Supabase) or nothing has been
 * logged yet, the PDF says so explicitly rather than being silently empty.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to download your login history." }, { status: 401 });
  }

  const { rows, configured } = await getLoginHistory();

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  doc.fontSize(16).text("PORTFOLIO EG — Sign-in History", { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor("#666").text(`Account: ${user.email ?? user.id}`);
  doc.text(`Generated: ${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`);
  doc.moveDown(1);
  doc.fillColor("#000");

  if (!configured) {
    doc
      .fontSize(11)
      .text(
        "The login_events table has not been created in Supabase yet — paste data/login-events.sql " +
          "into the Supabase SQL editor, then future sign-ins will appear here. Nothing is fabricated " +
          "in its place.",
        { width: 495 },
      );
  } else if (rows.length === 0) {
    doc
      .fontSize(11)
      .text(
        "No sign-ins have been logged on this account yet. History starts from the first sign-in " +
          "after this feature was enabled — earlier sessions were never recorded and cannot be " +
          "reconstructed.",
        { width: 495 },
      );
  } else {
    const colX = { day: 50, time: 150, event: 210, ip: 290, client: 390 };
    const header = () => {
      doc.fontSize(9).fillColor("#666");
      doc.text("Day", colX.day, doc.y, { continued: false, width: 95 });
      doc.text("Time (UTC)", colX.time, doc.y - 11, { width: 55 });
      doc.text("Event", colX.event, doc.y - 11, { width: 75 });
      doc.text("IP", colX.ip, doc.y - 11, { width: 95 });
      doc.text("Client", colX.client, doc.y - 11, { width: 155 });
      doc.moveDown(0.3);
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor("#ccc").stroke();
      doc.moveDown(0.3);
      doc.fillColor("#000");
    };
    header();
    for (const r of rows) {
      if (doc.y > 760) {
        doc.addPage();
        header();
      }
      const d = new Date(r.createdAt);
      const day = d.toLocaleDateString("en-GB", { weekday: "short", year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" });
      const time = d.toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false });
      const y = doc.y;
      doc.fontSize(9);
      doc.text(day, colX.day, y, { width: 95 });
      doc.text(time, colX.time, y, { width: 55 });
      doc.text(r.event.toUpperCase(), colX.event, y, { width: 75 });
      doc.text(r.ip ?? "—", colX.ip, y, { width: 95 });
      doc.text((r.userAgent ?? "—").slice(0, 60), colX.client, y, { width: 155 });
      doc.moveDown(0.6);
    }
    doc.moveDown(0.5);
    doc.fontSize(8).fillColor("#888").text(`${rows.length} sign-in event(s) total.`);
  }

  doc.end();
  const buf = await done;

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": 'attachment; filename="portfolio-eg-login-history.pdf"',
      "cache-control": "no-store",
    },
  });
}
