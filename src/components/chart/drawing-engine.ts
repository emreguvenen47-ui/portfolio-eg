/**
 * DRAWING ENGINE — declarative drawings stored as {time, price} points and
 * rendered onto an overlay canvas each frame. Times/prices, never pixels, so
 * a drawing stays glued to its candles at any zoom or range.
 *
 * Shared by MY DRAWINGS (user-created, persisted) and the EG ANALYSIS layer
 * (engine-generated, regenerated on demand) — two independent lists rendered
 * with different styling.
 */

export interface DrawPoint {
  time: string;
  price: number;
}

export type DrawingType =
  | "trendline"
  | "hline"
  | "vline"
  | "ray"
  | "extended"
  | "channel"
  | "rect"
  | "text"
  | "price-range"
  | "date-range"
  | "fib-retracement"
  | "fib-extension";

export interface Drawing {
  id: string;
  type: DrawingType;
  points: DrawPoint[];
  text?: string;
  color?: string;
  hidden?: boolean;
}

/** How many anchor points each tool needs before it is complete. */
export const POINTS_NEEDED: Record<DrawingType, number> = {
  trendline: 2,
  hline: 1,
  vline: 1,
  ray: 2,
  extended: 2,
  channel: 3,
  rect: 2,
  text: 1,
  "price-range": 2,
  "date-range": 2,
  "fib-retracement": 2,
  "fib-extension": 2,
};

export const TOOL_LABELS: Array<{ id: DrawingType | "select"; label: string; hint: string }> = [
  { id: "select", label: "☰", hint: "Select / move (V)" },
  { id: "trendline", label: "╱", hint: "Trend line" },
  { id: "hline", label: "─", hint: "Horizontal support/resistance" },
  { id: "vline", label: "│", hint: "Vertical line" },
  { id: "ray", label: "→", hint: "Ray" },
  { id: "extended", label: "↔", hint: "Extended line" },
  { id: "channel", label: "∥", hint: "Parallel channel (3 clicks)" },
  { id: "rect", label: "▭", hint: "Rectangle / zone" },
  { id: "text", label: "T", hint: "Text" },
  { id: "price-range", label: "%", hint: "Price range" },
  { id: "date-range", label: "⇤⇥", hint: "Date range" },
  { id: "fib-retracement", label: "F", hint: "Fibonacci retracement" },
  { id: "fib-extension", label: "Fx", hint: "Fibonacci extension" },
];

export interface CoordFns {
  x: (time: string) => number | null;
  y: (price: number) => number | null;
  priceAt: (y: number) => number | null;
  timeAt: (x: number) => string | null;
  width: number;
  height: number;
}

const FIB_R = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_X = [0, 0.618, 1, 1.272, 1.618, 2.0];

function px(d: Drawing, fns: CoordFns): Array<{ x: number; y: number } | null> {
  return d.points.map((p) => {
    const x = fns.x(p.time);
    const y = fns.y(p.price);
    return x === null || y === null ? null : { x, y };
  });
}

/** Extend a segment to the canvas bounds (both directions or forward only). */
function extendSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  w: number,
  mode: "ray" | "extended",
): [{ x: number; y: number }, { x: number; y: number }] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-6) return [a, { x: a.x, y: dy >= 0 ? 10_000 : -10_000 }];
  const slope = dy / dx;
  const at = (x: number) => ({ x, y: a.y + slope * (x - a.x) });
  const fwd = dx > 0 ? at(w + 50) : at(-50);
  if (mode === "ray") return [a, fwd];
  const back = dx > 0 ? at(-50) : at(w + 50);
  return [back, fwd];
}

export function renderDrawing(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  fns: CoordFns,
  opts: { selected?: boolean; eg?: boolean } = {},
): void {
  if (d.hidden) return;
  const pts = px(d, fns);
  const color = d.color ?? (opts.eg ? "#f59e0b" : "#22d3ee");
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = opts.selected ? 2 : 1.2;
  if (opts.eg) ctx.setLineDash([5, 4]);
  ctx.font = "10px ui-monospace, monospace";

  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  };

  const a = pts[0];
  const b = pts[1];
  switch (d.type) {
    case "hline": {
      if (!a) break;
      // Horizontal lines must render even when the anchor time scrolled out of
      // view — recompute y from price directly.
      const y = fns.y(d.points[0]!.price);
      if (y === null) break;
      line({ x: 0, y }, { x: fns.width, y });
      ctx.fillText(`${d.points[0]!.price.toFixed(2)}${d.text ? ` ${d.text}` : ""}`, 6, y - 4);
      break;
    }
    case "vline": {
      if (!a) break;
      line({ x: a.x, y: 0 }, { x: a.x, y: fns.height });
      ctx.fillText(d.points[0]!.time.slice(0, 10), a.x + 4, 12);
      break;
    }
    case "trendline":
      if (a && b) line(a, b);
      break;
    case "ray":
      if (a && b) {
        const [s, e] = extendSegment(a, b, fns.width, "ray");
        line(s, e);
      }
      break;
    case "extended":
      if (a && b) {
        const [s, e] = extendSegment(a, b, fns.width, "extended");
        line(s, e);
      }
      break;
    case "channel": {
      const c = pts[2];
      if (a && b) {
        line(a, b);
        if (c) {
          const off = { x: c.x - a.x, y: c.y - a.y };
          // Parallel line through the third point.
          line({ x: a.x + off.x, y: a.y + off.y }, { x: b.x + off.x, y: b.y + off.y });
          ctx.globalAlpha = 0.08;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(b.x + off.x, b.y + off.y);
          ctx.lineTo(a.x + off.x, a.y + off.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      break;
    }
    case "rect": {
      if (a && b) {
        ctx.globalAlpha = 0.1;
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        ctx.globalAlpha = 1;
        ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      }
      break;
    }
    case "text":
      if (a) {
        ctx.font = "11px ui-sans-serif, sans-serif";
        ctx.fillText(d.text ?? "text", a.x, a.y);
      }
      break;
    case "price-range": {
      if (a && b) {
        line(a, { x: a.x, y: b.y });
        const p0 = d.points[0]!.price;
        const p1 = d.points[1]!.price;
        const pct = p0 !== 0 ? ((p1 - p0) / p0) * 100 : 0;
        ctx.fillText(`${(p1 - p0).toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`, a.x + 5, (a.y + b.y) / 2);
        // arrowheads
        line({ x: a.x - 4, y: a.y }, { x: a.x + 4, y: a.y });
        line({ x: a.x - 4, y: b.y }, { x: a.x + 4, y: b.y });
      }
      break;
    }
    case "date-range": {
      if (a && b) {
        line(a, { x: b.x, y: a.y });
        ctx.fillText(`${d.points[0]!.time.slice(0, 10)} → ${d.points[1]!.time.slice(0, 10)}`, Math.min(a.x, b.x), a.y - 5);
        line({ x: a.x, y: a.y - 4 }, { x: a.x, y: a.y + 4 });
        line({ x: b.x, y: a.y - 4 }, { x: b.x, y: a.y + 4 });
      }
      break;
    }
    case "fib-retracement":
    case "fib-extension": {
      if (!a || !b) break;
      const hiP = Math.max(d.points[0]!.price, d.points[1]!.price);
      const loP = Math.min(d.points[0]!.price, d.points[1]!.price);
      const range = hiP - loP;
      const ratios = d.type === "fib-retracement" ? FIB_R : FIB_X;
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      for (const r of ratios) {
        const price = d.type === "fib-retracement" ? hiP - range * r : loP + range * r;
        const y = fns.y(price);
        if (y === null) continue;
        ctx.globalAlpha = r === 0 || r === 1 ? 1 : 0.75;
        line({ x: x0, y }, { x: x1 + 60, y });
        ctx.fillText(`${(r * 100).toFixed(1)}%  ${price.toFixed(2)}`, x1 + 4, y - 2);
      }
      ctx.globalAlpha = 1;
      break;
    }
  }

  // selection handles
  if (opts.selected) {
    ctx.setLineDash([]);
    for (const p of pts) {
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y)));
}

/** Which drawing (if any) is under the cursor; also which endpoint. */
export function hitTest(
  drawings: Drawing[],
  fns: CoordFns,
  pos: { x: number; y: number },
): { id: string; handle: number | null } | null {
  const TOL = 7;
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i]!;
    if (d.hidden) continue;
    const pts = px(d, fns);
    // endpoint handles first
    for (let h = 0; h < pts.length; h++) {
      const p = pts[h];
      if (p && Math.hypot(pos.x - p.x, pos.y - p.y) <= TOL) return { id: d.id, handle: h };
    }
    const a = pts[0];
    const b = pts[1];
    switch (d.type) {
      case "hline": {
        const y = fns.y(d.points[0]!.price);
        if (y !== null && Math.abs(pos.y - y) <= TOL) return { id: d.id, handle: null };
        break;
      }
      case "vline":
        if (a && Math.abs(pos.x - a.x) <= TOL) return { id: d.id, handle: null };
        break;
      case "trendline":
      case "ray":
      case "extended":
      case "price-range":
      case "date-range":
        if (a && b && distToSegment(pos, a, b) <= TOL) return { id: d.id, handle: null };
        break;
      case "channel": {
        const c = pts[2];
        if (a && b && distToSegment(pos, a, b) <= TOL) return { id: d.id, handle: null };
        if (a && b && c) {
          const off = { x: c.x - a.x, y: c.y - a.y };
          if (distToSegment(pos, { x: a.x + off.x, y: a.y + off.y }, { x: b.x + off.x, y: b.y + off.y }) <= TOL)
            return { id: d.id, handle: null };
        }
        break;
      }
      case "rect":
        if (
          a &&
          b &&
          pos.x >= Math.min(a.x, b.x) - TOL &&
          pos.x <= Math.max(a.x, b.x) + TOL &&
          pos.y >= Math.min(a.y, b.y) - TOL &&
          pos.y <= Math.max(a.y, b.y) + TOL
        )
          return { id: d.id, handle: null };
        break;
      case "text":
        if (a && Math.abs(pos.x - a.x) < 40 && Math.abs(pos.y - a.y) < 14) return { id: d.id, handle: null };
        break;
      case "fib-retracement":
      case "fib-extension":
        if (a && b && pos.x >= Math.min(a.x, b.x) - TOL && pos.x <= Math.max(a.x, b.x) + 60) {
          const hiP = Math.max(d.points[0]!.price, d.points[1]!.price);
          const loP = Math.min(d.points[0]!.price, d.points[1]!.price);
          const ratios = d.type === "fib-retracement" ? FIB_R : FIB_X;
          for (const r of ratios) {
            const price = d.type === "fib-retracement" ? hiP - (hiP - loP) * r : loP + (hiP - loP) * r;
            const y = fns.y(price);
            if (y !== null && Math.abs(pos.y - y) <= TOL) return { id: d.id, handle: null };
          }
        }
        break;
    }
  }
  return null;
}
