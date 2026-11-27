// Analog dial (SVG) used by the dashboard's "Dials" mode.
import { fmtNum } from "./i18n";
import { displayValue } from "./ui";

const NS = "http://www.w3.org/2000/svg";
const START = -135; // degrees, 0 = straight up
const SWEEP = 270;
const R = 80;

/** Values above which the dial shows a red zone (metric units). */
const RED_FROM: Record<string, number> = {
  rpm: 6000,
  coolant_temp: 110,
  coolant_temp_1: 110,
  oil_temp: 130,
  intake_temp: 70,
  egt_b1s1: 850,
};

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function point(angleDeg: number, r: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return [100 + r * Math.cos(a), 100 + r * Math.sin(a)];
}

function arc(from: number, to: number, r: number): string {
  const [x1, y1] = point(from, r);
  const [x2, y2] = point(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Rounds the dial's range to "nice" numbers so tick labels read well. */
function niceRange(min: number, max: number): [number, number] {
  const span = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span))) / 2;
  return [Math.floor(min / step) * step, Math.ceil(max / step) * step];
}

function tickLabel(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return `${fmtNum(v / 1000, 0)}k`;
  if (a >= 1000) return `${fmtNum(v / 1000, a % 1000 ? 1 : 0)}k`;
  return fmtNum(v, Number.isInteger(v) ? 0 : 1);
}

/** Dial for `key`; range and values are in the unit shown on screen. */
export function makeGauge(key: string, minIn: number, maxIn: number): { svg: SVGSVGElement; set: (v: number | undefined) => void } {
  const [min, max] = niceRange(minIn, maxIn);
  const frac = (v: number) => Math.max(0, Math.min(1, (v - min) / (max - min)));
  const svg = el("svg", { viewBox: "0 0 200 170", class: "gauge", role: "img" });
  svg.append(el("path", { d: arc(START, START + SWEEP, R), class: "gauge-track" }));
  const red = RED_FROM[key] === undefined ? undefined : displayValue(key, RED_FROM[key]);
  if (red !== undefined && red < max) {
    svg.append(el("path", { d: arc(START + SWEEP * frac(red), START + SWEEP, R), class: "gauge-red" }));
  }
  const fill = el("path", { d: "", class: "gauge-fill" });
  svg.append(fill);
  const majors = 5;
  for (let i = 0; i <= majors * 2; i++) {
    const ang = START + (SWEEP * i) / (majors * 2);
    const major = i % 2 === 0;
    const [x1, y1] = point(ang, R - 9);
    const [x2, y2] = point(ang, R - (major ? 18 : 14));
    svg.append(el("line", { x1, y1, x2, y2, class: major ? "gauge-tick major" : "gauge-tick" }));
    if (major) {
      const [tx, ty] = point(ang, R - 30);
      const text = el("text", { x: tx, y: ty + 4, class: "gauge-label", "text-anchor": "middle" });
      text.textContent = tickLabel(min + ((max - min) * i) / (majors * 2));
      svg.append(text);
    }
  }
  const needle = el("g", { class: "gauge-needle" });
  needle.append(el("path", { d: "M 97 100 L 100 34 L 103 100 Z" }), el("circle", { cx: 100, cy: 100, r: 6 }));
  svg.append(needle);

  // Symmetric ranges like −25…+25 % fill from zero, others from the minimum.
  const symmetric = min < 0 && max > 0 && Math.abs(min + max) < 0.2 * (max - min);
  const origin = START + SWEEP * (symmetric ? frac(0) : 0);
  let shown = min;
  const set = (v: number | undefined) => {
    const f = v === undefined ? 0 : frac(v);
    const ang = START + SWEEP * f;
    needle.style.transform = `rotate(${ang.toFixed(2)}deg)`;
    const [a, b] = ang >= origin ? [origin, ang] : [ang, origin];
    fill.setAttribute("d", b - a > 0.5 ? arc(a, b, R) : "");
    shown = v ?? min;
    svg.classList.toggle("in-red", red !== undefined && shown >= red);
  };
  set(undefined);
  return { svg, set };
}
