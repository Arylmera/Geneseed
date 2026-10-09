/**
 * The scorecard as an SVG card — the grade, and one bar per pillar — for a README.
 *
 * WHY A FILE AND NOT A BADGE SERVICE. A shields.io badge carries one number; the point of the card
 * is the five pillars side by side, which is where a reader sees what to fix. And a card nobody
 * regenerates is a lie with a date on it, so `checks-repo.mjs` compares this repo's committed card
 * against a fresh render on every doctor run in a checkout: the drawing cannot drift from the
 * score.
 *
 * DETERMINISTIC ON PURPOSE. No date, no repo path, no folder name (a worktree's name differs from
 * CI's checkout), nothing but the assessment's numbers — so the same tree renders the same bytes
 * on every machine, which is what lets doctor compare them. Colours follow the viewer's theme
 * through a `prefers-color-scheme` block, which GitHub honours inside an `<img>` SVG.
 */
import { round1 } from './scorecard.mjs';

/** The grade band a percentage falls in — the same thresholds as the overall grade. */
const band = (pct) => (pct >= 85 ? 'a' : pct >= 70 ? 'b' : pct >= 55 ? 'c' : pct >= 40 ? 'd' : 'f');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Render an assessment (from `assessRepo`) as a standalone SVG document. */
export function renderSvg(a) {
  const W = 760;
  const top = 96;
  const rowH = 46;
  const H = top + a.categories.length * rowH + 40;
  const barX = 300;
  const barW = 330;
  const rows = a.categories.map((c, i) => {
    const y = top + i * rowH;
    const pct = round1(c.percentage);
    const passed = c.checks.filter((k) => k.passed).length;
    const w = Math.max(0, Math.min(barW, (barW * c.percentage) / 100));
    return [
      `  <text class="label" x="32" y="${y + 20}">${esc(c.name)}</text>`,
      `  <text class="muted" x="32" y="${y + 37}">weight ${Math.round(c.weight * 100)} % · ${passed}/${c.checks.length} checks</text>`,
      `  <rect class="track" x="${barX}" y="${y + 10}" width="${barW}" height="16" rx="8"/>`,
      `  <rect class="bar ${band(c.percentage)}" x="${barX}" y="${y + 10}" width="${round1(w)}" height="16" rx="8"/>`,
      `  <text class="pct" x="${W - 32}" y="${y + 24}" text-anchor="end">${pct} %</text>`,
    ].join('\n');
  });
  const g = band(a.overallScore);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="AI Harness Scorecard: grade ${a.grade}, ${round1(a.overallScore)} out of 100">
  <style>
    svg { --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --track: #eaeef2; --line: #d0d7de;
          --a: #1a7f37; --b: #0969da; --c: #9a6700; --d: #bc4c00; --f: #cf222e; }
    @media (prefers-color-scheme: dark) {
      svg { --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --track: #21262d; --line: #30363d;
            --a: #3fb950; --b: #4493f8; --c: #d29922; --d: #db6d28; --f: #f85149; }
    }
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; fill: var(--fg); }
    .title { font-size: 20px; font-weight: 600; }
    .label { font-size: 15px; font-weight: 600; }
    .muted { font-size: 12px; fill: var(--muted); }
    .pct { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .grade { font-size: 30px; font-weight: 700; fill: #ffffff; }
    .score { font-size: 22px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .track { fill: var(--track); }
    .a { fill: var(--a); } .b { fill: var(--b); } .c { fill: var(--c); } .d { fill: var(--d); } .f { fill: var(--f); }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="var(--bg)" stroke="var(--line)"/>
  <text class="title" x="32" y="44">AI Harness Scorecard</text>
  <text class="muted" x="32" y="66">${a.passedChecks} of ${a.totalChecks} deterministic checks passing · five weighted pillars</text>
  <text class="score" x="${W - 100}" y="56" text-anchor="end">${round1(a.overallScore)}<tspan class="muted"> / 100</tspan></text>
  <rect class="${g}" x="${W - 84}" y="22" width="52" height="52" rx="10"/>
  <text class="grade" x="${W - 58}" y="59" text-anchor="middle">${a.grade}</text>
  <line x1="32" y1="${top - 12}" x2="${W - 32}" y2="${top - 12}" stroke="var(--line)"/>
${rows.join('\n')}
  <text class="muted" x="32" y="${H - 16}">markmishaev76/ai-harness-scorecard, ported to JavaScript · geneseed scorecard --svg</text>
</svg>
`;
}

/** shields.io's named colours, one per band — the upstream tool's badge style (grey label, bright value). */
const BADGE_COLOUR = { a: 'brightgreen', b: 'green', c: 'yellow', d: 'orange', f: 'red' };

/**
 * The README badge for an assessment — grade and score, coloured by band. `--svg` prints it next to
 * writing the card, and doctor requires the README to carry exactly this URL, so the one number a
 * reader sees first cannot lag the card below it.
 */
export function badgeUrl(a) {
  return `https://img.shields.io/badge/AI%20Harness%20Scorecard-${a.grade}%20${round1(a.overallScore)}%2F100-${BADGE_COLOUR[band(a.overallScore)]}`;
}
