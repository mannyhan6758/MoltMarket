import { useRef, useEffect } from 'react';
import type { Trade } from '../types.js';

interface Props {
  trades: Trade[];
  error: string | null;
}

const CHART_W = 600;
const CHART_H = 200;
const PAD = { top: 20, right: 60, bottom: 30, left: 10 };

/**
 * Minimal SVG line chart of trade prices over tick time.
 * No external charting library needed.
 */
export function PriceChart({ trades, error }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Deduplicate: one price per tick (last trade wins)
  const byTick = new Map<number, number>();
  for (const t of trades) {
    byTick.set(t.tick_id, parseFloat(t.price));
  }
  const points = Array.from(byTick.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([tick, price]) => ({ tick, price }));

  if (error && points.length === 0) {
    return (
      <section className="panel">
        <h2>Price</h2>
        <div className="error-panel">Trades error: {error}</div>
      </section>
    );
  }

  if (points.length === 0) {
    return (
      <section className="panel">
        <h2>Price</h2>
        <p className="muted">No trades yet</p>
      </section>
    );
  }

  const lastPrice = points[points.length - 1]!;
  const prices = points.map((p) => p.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const pRange = maxP - minP || 1;
  const minT = points[0]!.tick;
  const maxT = lastPrice.tick;
  const tRange = maxT - minT || 1;

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;

  const toX = (tick: number) => PAD.left + ((tick - minT) / tRange) * plotW;
  const toY = (price: number) => PAD.top + plotH - ((price - minP) / pRange) * plotH;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.tick).toFixed(1)},${toY(p.price).toFixed(1)}`)
    .join(' ');

  // Y-axis labels
  const yLabels = [minP, minP + pRange / 2, maxP].map((v) => ({
    y: toY(v),
    label: v.toFixed(2),
  }));

  return (
    <section className="panel">
      <h2>Price <span className="muted">Last: {lastPrice.price.toFixed(2)} @ tick {lastPrice.tick}</span></h2>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="price-chart"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {yLabels.map((yl, i) => (
          <g key={i}>
            <line
              x1={PAD.left} y1={yl.y}
              x2={CHART_W - PAD.right} y2={yl.y}
              stroke="#333" strokeDasharray="4,4"
            />
            <text x={CHART_W - PAD.right + 4} y={yl.y + 4} fill="#888" fontSize="11">
              {yl.label}
            </text>
          </g>
        ))}
        {/* Price line */}
        <path d={pathD} fill="none" stroke="#4fc3f7" strokeWidth="2" />
        {/* Last price dot */}
        <circle cx={toX(lastPrice.tick)} cy={toY(lastPrice.price)} r="4" fill="#4fc3f7" />
      </svg>
    </section>
  );
}
