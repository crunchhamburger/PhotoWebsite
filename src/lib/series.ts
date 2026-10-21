import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import config from '../data/series.json';

// Government data series for the podcast's original charts (see scripts/fetch-series.mjs).
// Read at build time from src/data/series/<id>.csv.

export type SeriesId = keyof typeof config.series;
export type SeriesMeta = (typeof config.series)[SeriesId] & { note?: string };
export type Point = { t: number; v: number };
export type Line = { id: SeriesId; meta: SeriesMeta; label: string; unit: string; decimals: number; points: Point[] };

const cache = new Map<string, Point[]>();

function load(id: SeriesId): Point[] {
  let rows = cache.get(id);
  if (!rows) {
    const text = readFileSync(resolve('src/data/series', `${id}.csv`), 'utf8');
    rows = text
      .trim()
      .split('\n')
      .slice(1)
      .map((l) => {
        const [d, v] = l.split(',');
        return { t: Date.parse(d), v: Number(v) };
      });
    cache.set(id, rows);
  }
  return rows;
}

export const seriesMeta = (id: SeriesId): SeriesMeta => config.series[id];

const RANGE_MONTHS: Record<string, number> = { '3m': 3, '6m': 6, '1y': 12, '2y': 24, '5y': 60, '10y': 120 };

/** First instant of the chart window ending at `end`. */
function windowStart(end: number, range: string): number {
  if (range === 'max') return -Infinity;
  const d = new Date(end);
  if (range === 'ytd') return Date.UTC(d.getUTCFullYear(), 0, 1);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - RANGE_MONTHS[range], d.getUTCDate());
}

/**
 * One series for a chart: observations up to the episode date (so an old episode's chart never
 * changes), over `range`, optionally as % change on the same month a year earlier.
 */
export function seriesLine(id: SeriesId, asOf: Date, range: string, transform: 'level' | 'yoy'): Line {
  const meta = seriesMeta(id);
  const all = load(id).filter((p) => p.t <= asOf.getTime());
  if (!all.length) throw new Error(`No ${id} data on or before ${asOf.toISOString().slice(0, 10)}`);
  let pts = all;
  let unit = meta.unit;
  let decimals = meta.decimals;
  if (transform === 'yoy') {
    const byMonth = new Map(all.map((p) => [new Date(p.t).toISOString().slice(0, 7), p.v]));
    pts = all.flatMap((p) => {
      const d = new Date(p.t);
      const prior = byMonth.get(new Date(Date.UTC(d.getUTCFullYear() - 1, d.getUTCMonth(), 1)).toISOString().slice(0, 7));
      return prior ? [{ t: p.t, v: (p.v / prior - 1) * 100 }] : [];
    });
    unit = '% y/y';
    decimals = 1;
  }
  const start = windowStart(pts[pts.length - 1].t, range);
  return { id, meta, label: meta.short, unit, decimals, points: pts.filter((p) => p.t >= start) };
}

/** 5.15 → "5.15%", 126.5 → "$126.50", 121.4 → "121.40". */
export function formatValue(v: number, unit: string, decimals: number): string {
  const n = v.toFixed(decimals);
  if (unit === '%' || unit === '% y/y') return `${n}%`;
  if (unit.startsWith('$')) return `$${n}`;
  return n;
}

export const unitLabel = (unit: string, lang: 'en' | 'zh' = 'en') =>
  (lang === 'zh'
    ? { '%': '百分比', '% y/y': '同比变化（%）', '$/bbl': '美元/桶', index: '指数' }
    : { '%': 'Percent', '% y/y': 'Percent change on a year earlier', '$/bbl': 'U.S. dollars per barrel', index: 'Index' })[unit] ?? unit;

/** "Oct 19, 2026" / "2026年10月19日", or "Sep 2026" / "2026年9月" for monthly data. */
export const formatDay = (t: number, frequency = 'daily', lang: 'en' | 'zh' = 'en') => {
  if (lang === 'zh') {
    const d = new Date(t);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${frequency === 'monthly' ? '' : `${d.getUTCDate()}日`}`;
  }
  return new Date(t).toLocaleDateString('en-US', {
    month: 'short',
    day: frequency === 'monthly' ? undefined : 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

/** About `count` round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

/** Date ticks for the x axis: years, quarters or months depending on the span. */
export function timeTicks(t0: number, t1: number, lang: 'en' | 'zh' = 'en'): { t: number; label: string }[] {
  const span = (t1 - t0) / (365.25 * 86400000);
  const s = new Date(t0);
  const out: { t: number; label: string }[] = [];
  if (span > 3) {
    const step = Math.ceil(span / 5);
    for (let y = s.getUTCFullYear() + 1; ; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t > t1) break;
      out.push({ t, label: String(y) });
    }
  } else {
    const stepMonths = span > 1.5 ? 6 : span > 0.75 ? 3 : span > 0.3 ? 2 : 1;
    let y = s.getUTCFullYear();
    let m = s.getUTCMonth() + 1;
    while (m % stepMonths) m++;
    for (;;) {
      const t = Date.UTC(y, m, 1);
      if (t > t1) break;
      const d = new Date(t);
      const first = d.getUTCMonth() === 0 || out.length === 0;
      if (lang === 'zh') {
        out.push({ t, label: first ? `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月` : `${d.getUTCMonth() + 1}月` });
      } else {
        const mon = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
        out.push({ t, label: first ? `${mon} ’${String(d.getUTCFullYear()).slice(2)}` : mon });
      }
      m += stepMonths;
    }
  }
  return out;
}

/** Keeps at most `max` points (always the first and last) so long daily series stay small. */
export function thin(points: Point[], max = 400): Point[] {
  if (points.length <= max) return points;
  const k = Math.ceil(points.length / max);
  const out = points.filter((_, i) => i % k === 0);
  if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
  return out;
}
