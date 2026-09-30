#!/usr/bin/env node
/**
 * Render an explain-changes report — one self-contained, offline HTML page that walks a human
 * through a diff before they commit it.
 *
 * WHY A SCRIPT AND NOT THE MODEL. The model writes only the narrative (the brief: intent,
 * risks, logical units). Every diff line on the page comes from `git diff`, run here, and is
 * escaped here. A model that retypes a diff pays output tokens in proportion to the diff and
 * can alter a line of the very thing under review; this file cannot.
 *
 * The script only READS git. It never touches the index or the working tree.
 *
 * Usage:
 *   node render_changes.mjs --brief <file.json> [--out <notebook-dir>] [--base <ref>]
 *   node render_changes.mjs --hash [--base <ref>]
 * Exit: 0 written (mismatches, if any, go to stderr and onto a banner) · 2 usage · 3 empty diff.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const MAX_FILE_LINES = 1500;

function git(cwd, args, input) {
  return execFileSync('git', ['-c', 'core.quotePath=false', ...args], {
    cwd, input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function gitOr(cwd, args, fallback) {
  try { return git(cwd, args).trim(); } catch { return fallback; }
}

/**
 * Untracked files as the diff `git add` would produce. Read here rather than via `git add -N`,
 * which would write the index. A nested repository is listed as `sub/` and cannot be read as a
 * file, and a broken symlink has nothing to read: both are written the way git writes them
 * (a gitlink header; a symlink's target as its one line), since reading either would throw.
 */
function untrackedAsDiff(root) {
  const paths = git(root, ['ls-files', '--others', '--exclude-standard', '-z'])
    .split('\0').filter(Boolean);
  let out = '';
  for (const listed of paths) {
    const full = path.join(root, listed);
    const st = fs.lstatSync(full);
    const p = listed.replace(/\/$/, '');
    if (st.isDirectory()) { out += `diff --git a/${p} b/${p}\nnew file mode 160000\n`; continue; }
    if (st.isSymbolicLink()) {
      out += `diff --git a/${p} b/${p}\nnew file mode 120000\n--- /dev/null\n+++ b/${p}\n@@ -0,0 +1 @@\n`
        + `+${fs.readlinkSync(full)}\n\\ No newline at end of file\n`;
      continue;
    }
    const buf = fs.readFileSync(full);
    out += `diff --git a/${p} b/${p}\nnew file mode 100644\n`;
    if (buf.includes(0)) { out += `Binary files /dev/null and b/${p} differ\n`; continue; }
    const text = buf.toString('utf8');
    if (!text) continue;
    const lines = text.split('\n');
    const noEol = lines[lines.length - 1] !== '';
    if (!noEol) lines.pop();
    out += `--- /dev/null\n+++ b/${p}\n@@ -0,0 +1,${lines.length} @@\n`
      + lines.map((l) => `+${l}`).join('\n') + '\n';
    if (noEol) out += '\\ No newline at end of file\n';
  }
  return out;
}

/** Staged if anything is staged (what the commit will hold), else the working tree. */
export function selectDiff(root, base) {
  const common = ['diff', '--no-color', '--no-ext-diff', '-M'];
  if (base) return { mode: `${base}...HEAD`, text: git(root, [...common, `${base}...HEAD`]) };
  const head = gitOr(root, ['rev-parse', '--verify', '-q', 'HEAD'], '') ? 'HEAD' : EMPTY_TREE;
  const staged = git(root, [...common, '--cached', head]);
  if (staged) return { mode: 'staged', text: staged };
  return { mode: 'working tree', text: git(root, [...common, head]) + untrackedAsDiff(root) };
}

export const diffHash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

export function parseDiff(text) {
  const files = [];
  let f = null;
  let h = null;
  let o = 0;
  let n = 0;
  for (const line of text.split('\n')) {
    if (line.startsWith('diff --git ')) {
      // ponytail: a path containing " b/" splits wrong here; the rename/copy lines correct it
      const m = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
      f = {
        path: m ? m[2] : line.slice(11), oldPath: m ? m[1] : '', status: 'modified',
        binary: false, generated: false, truncated: false, hunks: [], add: 0, del: 0, shown: 0,
      };
      files.push(f);
      h = null;
      continue;
    }
    if (!f) continue;
    const hm = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hm) {
      h = { header: line, lines: [] };
      f.hunks.push(h);
      o = Number(hm[1]);
      n = Number(hm[2]);
      continue;
    }
    if (!h) {
      if (line.startsWith('new file mode')) f.status = 'added';
      else if (line.startsWith('deleted file mode')) f.status = 'deleted';
      else if (line.startsWith('rename from ')) { f.status = 'renamed'; f.oldPath = line.slice(12); }
      else if (line.startsWith('rename to ')) f.path = line.slice(10);
      else if (line.startsWith('copy from ')) { f.status = 'copied'; f.oldPath = line.slice(10); }
      else if (line.startsWith('copy to ')) f.path = line.slice(8);
      else if (line.startsWith('Binary files ') || line === 'GIT binary patch') f.binary = true;
      continue;
    }
    const t = line[0];
    if (t === '+') f.add++;
    else if (t === '-') f.del++;
    else if (t !== ' ' && t !== '\\') continue;
    if (f.shown >= MAX_FILE_LINES) { f.truncated = true; continue; }
    f.shown++;
    const body = line.slice(1);
    if (t === '+') h.lines.push({ t: 'add', n: n++, text: body });
    else if (t === '-') h.lines.push({ t: 'del', o: o++, text: body });
    else if (t === ' ') h.lines.push({ t: 'ctx', o: o++, n: n++, text: body });
    else h.lines.push({ t: 'note', text: line });
  }
  return files;
}

const GENERATED = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|(^|\/)dist\//;

export function markGenerated(root, files) {
  let attrs = '';
  try {
    attrs = git(root, ['check-attr', '--stdin', 'linguist-generated'],
      files.map((f) => f.path).join('\n') + '\n');
  } catch { /* no attributes → only the name patterns apply */ }
  const marked = new Set();
  for (const l of attrs.split('\n')) {
    const i = l.lastIndexOf(': linguist-generated: ');
    if (i > 0 && /: (true|set)$/.test(l)) marked.add(l.slice(0, i));
  }
  for (const f of files) f.generated = GENERATED.test(f.path) || marked.has(f.path);
}

/**
 * Inline SVG from the model: one <svg> element and nothing after it, no script, no handler, no
 * foreign HTML, no animation that rewrites a link, nothing outside the page. A denylist can be
 * bypassed; the page's CSP is what actually stops a script or a fetch. This check exists so an
 * unsafe diagram raises the mismatch banner instead of rendering inert and unnoticed.
 */
export function safeSvg(svg) {
  const t = String(svg).trim();
  const close = t.toLowerCase().indexOf('</svg>');
  const shape = /^<svg[\s>/][\s\S]*<\/svg>$/i.test(t) ? close === t.length - 6 : /^<svg[^>]*\/>$/i.test(t);
  return shape
    && !/<script|<foreignObject|\son\w+\s*=|href\s*=\s*(?!["']?#)|url\(\s*(?!["']?#)/i.test(t)
    && !/attributeName\s*=\s*["']?(xlink:)?href/i.test(t)
    && !/<(iframe|img|meta|form|link|object|embed|style|base)\b|javascript:/i.test(t);
}

export const unitFiles = (u) => [...new Set([...(u.files ?? []), ...Object.keys(u.hunks ?? {})])];

export function checkBrief(brief, files) {
  const problems = [];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const covered = new Set();
  for (const u of brief.units ?? []) {
    for (const p of unitFiles(u)) {
      if (byPath.has(p)) covered.add(p);
      else problems.push(`unit "${u.title}" cites ${p}, which is not in the diff`);
    }
    for (const [p, idx] of Object.entries(u.hunks ?? {})) {
      const f = byPath.get(p);
      if (!f) continue;
      for (const i of idx) {
        if (!f.hunks[i]) problems.push(`unit "${u.title}" cites hunk ${i} of ${p}, which has ${f.hunks.length}`);
      }
    }
    if (u.svg && !safeSvg(u.svg)) problems.push(`unit "${u.title}": diagram dropped (unsafe SVG)`);
  }
  for (const f of files) {
    if (!covered.has(f.path) && !f.generated) problems.push(`${f.path} is changed but no unit explains it`);
  }
  if (!brief.risks?.length && !brief.risks_none_reason) {
    problems.push('no risks listed and no risks_none_reason given');
  }
  return problems;
}

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[^/]+$/;
const RISK_ORDER = { high: 0, medium: 1, low: 2 };

const LABELS = {
  en: {
    request: 'Original request', inShort: 'In short', checkFirst: 'Check first',
    walkthrough: 'Walkthrough', appendix: 'Appendix — full diff',
    mismatch: 'The narrative does not match the diff', noRisks: 'No risks listed',
    files: 'files', tests: 'test files', outOfScope: 'out of scope',
    high: 'high', medium: 'medium', low: 'low', binary: 'binary', generated: 'generated',
    truncated: `truncated after ${MAX_FILE_LINES} lines`, light: '☀ Light', dark: '☾ Dark',
    generatedOn: 'generated',
    status: { added: 'added', deleted: 'deleted', modified: 'modified', renamed: 'renamed', copied: 'copied' },
  },
  fr: {
    request: "Demande d'origine", inShort: 'En bref', checkFirst: 'À vérifier en priorité',
    walkthrough: 'Parcours des changements', appendix: 'Annexe — diff complet',
    mismatch: 'Le récit ne correspond pas au diff', noRisks: 'Aucun risque listé',
    files: 'fichiers', tests: 'fichiers de test', outOfScope: 'hors périmètre',
    high: 'élevé', medium: 'moyen', low: 'faible', binary: 'binaire', generated: 'généré',
    truncated: `tronqué après ${MAX_FILE_LINES} lignes`, light: '☀ Clair', dark: '☾ Sombre',
    generatedOn: 'généré le',
    status: { added: 'nouveau', deleted: 'supprimé', modified: 'modifié', renamed: 'renommé', copied: 'copié' },
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const code = (s) => esc(s).replace(/\r$/, '<span class="cr" title="CR">␍</span>');

function splitRows(h) {
  const side = (l, which) => (l
    ? `<td class="n ${l.t}">${which === 'o' ? l.o : l.n}</td><td class="c ${l.t}">${code(l.text)}</td>`
    : '<td class="n empty"></td><td class="c empty"></td>');
  const L = h.lines;
  let r = '';
  let i = 0;
  while (i < L.length) {
    if (L[i].t === 'ctx') { r += `<tr>${side(L[i], 'o')}${side(L[i], 'n')}</tr>`; i++; continue; }
    if (L[i].t === 'note') { r += `<tr><td class="note" colspan="4">${esc(L[i].text)}</td></tr>`; i++; continue; }
    const dels = [];
    const adds = [];
    while (i < L.length && L[i].t === 'del') dels.push(L[i++]);
    while (i < L.length && L[i].t === 'add') adds.push(L[i++]);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      r += `<tr>${side(dels[k], 'o')}${side(adds[k], 'n')}</tr>`;
    }
  }
  return r;
}

function singleRows(h, added) {
  return h.lines.map((l) => (l.t === 'note'
    ? `<tr><td class="note" colspan="3">${esc(l.text)}</td></tr>`
    : `<tr><td class="n ${l.t}">${added ? l.n : l.o}</td><td class="s ${l.t}">${added ? '+' : '−'}</td>`
      + `<td class="c ${l.t}">${code(l.text)}</td></tr>`)).join('');
}

function diffTable(f, hunks) {
  if (f.binary || !hunks.length) return '';
  const single = f.status === 'added' || f.status === 'deleted';
  const rows = hunks.map((h) => `<tr class="hunk"><td colspan="${single ? 3 : 4}">${esc(h.header)}</td></tr>`
    + (single ? singleRows(h, f.status === 'added') : splitRows(h))).join('');
  return `<div class="diffwrap"><table class="diff ${single ? 'single' : 'split'}">${rows}</table></div>`;
}

function fileHead(f, L) {
  const tags = [f.binary && L.binary, f.generated && L.generated, f.truncated && L.truncated]
    .filter(Boolean).map((t) => `<span class="tag">${esc(t)}</span> `).join('');
  return `<div class="fhead"><span class="path">diff --git a/${esc(f.oldPath || f.path)} b/${esc(f.path)}</span>`
    + `<span>${tags}${esc(L.status[f.status])} · <span class="plus">+${f.add}</span> `
    + `<span class="minus">−${f.del}</span></span></div>`;
}

const CSS = `
:root{--bg:#16181c;--panel:#1d2025;--ink:#e6e7e9;--muted:#9a9ea6;--line:#2e3238;--accent:#8aa4ff;
--add-bg:#16311f;--add-ink:#8fe0a6;--add-gut:#1d4029;--del-bg:#3a1a1d;--del-ink:#ff9aa2;--del-gut:#4a2226;
--hunk-bg:#1f2638;--hunk-ink:#8aa4ff;--high:#ff7b6b;--medium:#f0b44c;--low:#a8cf6f;--code-bg:#191b1f;color-scheme:dark}
:root[data-theme="light"]{--bg:#fbfbfa;--panel:#fff;--ink:#1d1f23;--muted:#62666d;--line:#e3e4e6;--accent:#3a5bd9;
--add-bg:#e6f6ea;--add-ink:#1a6b33;--add-gut:#cdeed6;--del-bg:#fdebec;--del-ink:#a1232b;--del-gut:#f8d4d7;
--hunk-bg:#eef2fd;--hunk-ink:#3a5bd9;--high:#c0392b;--medium:#c77c02;--low:#5a7d2a;--code-bg:#f6f7f8;color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{padding:32px clamp(16px,3vw,48px) 64px}
.ask,.summary,.why{max-width:110ch}
code,.path,.diff,.chip,footer{font-family:ui-monospace,"Cascadia Code","SF Mono",Consolas,monospace;font-size:12.5px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:40px 0 12px}h3{font-size:15px;margin:0}
.muted{color:var(--muted)}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
button{font:inherit;font-size:13px;background:var(--panel);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:5px 10px;cursor:pointer}
.ask{margin:16px 0;padding:12px 16px;border-left:3px solid var(--accent);background:var(--panel);border-radius:0 8px 8px 0}
.label{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:13px}
.plus{color:var(--add-ink)}.minus{color:var(--del-ink)}
.summary{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:16px 20px}
.mismatch{margin:16px 0;padding:12px 16px;border:1px solid var(--high);border-radius:10px;color:var(--high)}
.checks{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.checks li{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;grid-template-columns:auto auto 1fr;gap:10px;align-items:start}
.checks input{margin-top:4px;width:16px;height:16px}
.checks li.done{opacity:.55}.checks li.done .what{text-decoration:line-through}
.checks a{color:var(--accent);text-decoration:none;font-size:13px}
.sev{font-size:11px;font-weight:600;text-transform:uppercase;padding:2px 7px;border-radius:999px;border:1px solid;white-space:nowrap}
.sev.high{color:var(--high)}.sev.medium{color:var(--medium)}.sev.low{color:var(--low)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;margin:16px 0;overflow:hidden}
.card>.head{padding:16px 20px;border-bottom:1px solid var(--line)}
.step{font-size:12px;color:var(--muted)}.why{margin:6px 0 0}
.files{margin-top:8px;display:flex;gap:6px;flex-wrap:wrap}
.chip{background:var(--code-bg);border:1px solid var(--line);border-radius:6px;padding:1px 7px}
.diagram{padding:16px 20px;border-bottom:1px solid var(--line);color:var(--ink)}
.diagram svg{width:100%;height:auto;max-width:900px;display:block;margin:0 auto}
.file+.file{border-top:1px solid var(--line)}
.fhead{display:flex;justify-content:space-between;gap:8px;padding:8px 14px;background:var(--code-bg);border-bottom:1px solid var(--line);font-size:12.5px}
.path{font-weight:600;overflow-wrap:anywhere}
.tag{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:0 6px}
.diffwrap{overflow-x:auto}
.diff{width:100%;border-collapse:collapse;table-layout:fixed;tab-size:4}
.diff td{padding:0 8px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}
.diff td.n{width:52px;text-align:right;color:var(--muted);user-select:none;padding:0 6px}
.diff td.s{width:18px;text-align:center;user-select:none;padding:0}
.diff td.add{background:var(--add-bg);color:var(--add-ink)}.diff td.n.add{background:var(--add-gut)}
.diff td.del{background:var(--del-bg);color:var(--del-ink)}.diff td.n.del{background:var(--del-gut)}
.diff td.empty{background:var(--code-bg)}
.diff tr.hunk td{background:var(--hunk-bg);color:var(--hunk-ink);padding:3px 8px}
.diff td.note{color:var(--muted);font-style:italic}
.cr{color:var(--muted)}
details>summary{cursor:pointer;list-style:none}details>summary::-webkit-details-marker{display:none}
details>summary .fhead::before{content:"▸ "}details[open]>summary .fhead::before{content:"▾ "}
footer{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted)}
`;

const JS = `
const R=document.documentElement,B=document.getElementById('theme');
function set(t){R.dataset.theme=t;B.textContent=t==='dark'?B.dataset.light:B.dataset.dark;
try{localStorage.setItem('explain-changes-theme',t)}catch(e){}}
let t='dark';try{t=localStorage.getItem('explain-changes-theme')||'dark'}catch(e){}
set(t);B.onclick=()=>set(R.dataset.theme==='dark'?'light':'dark');
document.querySelectorAll('.checks input').forEach(c=>c.onchange=()=>c.closest('li').classList.toggle('done',c.checked));
`;

// The CSP is the barrier: no script runs but the page's own (pinned by hash, so it must be
// byte-identical to what sits between <script> and </script>), nothing is fetched, no form posts.
// safeSvg is only the check that raises the banner.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; "
  + `script-src 'sha256-${createHash('sha256').update(JS).digest('base64')}'; form-action 'none'; base-uri 'none'`;

export function renderPage({ brief, files, problems, meta }) {
  const lang = LABELS[brief.lang] ? brief.lang : 'en';
  const L = LABELS[lang];
  const byPath = new Map(files.map((f) => [f.path, f]));
  const units = (brief.units ?? []).map((u, i) => ({ ...u, id: u.id ?? `u${i + 1}` }));
  const titleOf = (id) => units.find((u) => u.id === id)?.title ?? id;
  const add = files.reduce((s, f) => s + f.add, 0);
  const del = files.reduce((s, f) => s + f.del, 0);
  const tests = files.filter((f) => TEST_PATH.test(f.path)).length;
  const oos = units.filter((u) => u.out_of_scope).length;

  const risks = [...(brief.risks ?? [])]
    .map((r) => ({ ...r, level: r.level in RISK_ORDER ? r.level : 'low' }))
    .sort((a, b) => RISK_ORDER[a.level] - RISK_ORDER[b.level]);
  const riskHtml = risks.length
    ? `<ul class="checks">${risks.map((r) => `<li><input type="checkbox"><span class="sev ${r.level}">${esc(L[r.level])}</span>`
      + `<div><div class="what">${esc(r.text)}</div>`
      + `${r.unit ? `<a href="#${esc(r.unit)}">→ ${esc(titleOf(r.unit))}</a>` : ''}</div></li>`).join('')}</ul>`
    : `<p class="muted">${esc(L.noRisks)} — ${esc(brief.risks_none_reason)}</p>`;

  const cards = units.map((u, i) => {
    const paths = unitFiles(u);
    const diffs = paths.map((p) => {
      const f = byPath.get(p);
      if (!f) return '';
      const idx = u.hunks?.[p];
      const hunks = idx ? idx.map((k) => f.hunks[k]).filter(Boolean) : f.hunks;
      return `<div class="file">${fileHead(f, L)}${diffTable(f, hunks)}</div>`;
    }).join('');
    const svg = u.svg && safeSvg(u.svg) ? `<div class="diagram">${u.svg}</div>` : '';
    return `<section class="card" id="${esc(u.id)}"><div class="head">`
      + `<div class="step">${i + 1} / ${units.length}${u.kind ? ` · ${esc(u.kind)}` : ''}</div>`
      + `<h3>${esc(u.title)}</h3><p class="why">${esc(u.why)}</p>`
      + `<div class="files">${paths.map((p) => `<span class="chip">${esc(p)}</span>`).join('')}</div>`
      + `</div>${svg}${diffs}</section>`;
  }).join('');

  const appendix = files.map((f) => `<details class="card file"><summary>${fileHead(f, L)}</summary>`
    + `${f.generated ? '' : diffTable(f, f.hunks)}</details>`).join('');
  const banner = problems.length
    ? `<div class="mismatch"><strong>${esc(L.mismatch)}</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`
    : '';

  return `<!doctype html>
<html lang="${lang}" data-theme="dark">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(brief.title)} — ${esc(meta.branch)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<div class="top"><div><h1>${esc(brief.title)}</h1><div class="muted">${esc(meta.branch)} · ${esc(meta.mode)}</div></div>
<button id="theme" data-light="${esc(L.light)}" data-dark="${esc(L.dark)}">${esc(L.light)}</button></div>
<div class="ask"><div class="label">${esc(L.request)}</div>${esc(brief.request)}</div>
<div class="stats"><span class="stat"><b>${files.length}</b> ${esc(L.files)}</span>
<span class="stat plus"><b>+${add}</b></span><span class="stat minus"><b>−${del}</b></span>
<span class="stat"><b>${tests}</b> ${esc(L.tests)}</span><span class="stat"><b>${oos}</b> ${esc(L.outOfScope)}</span></div>
</header>
${banner}
<h2>${esc(L.inShort)}</h2>
<div class="summary">${esc(brief.summary)}</div>
<h2>${esc(L.checkFirst)}</h2>
${riskHtml}
<h2>${esc(L.walkthrough)}</h2>
${cards}
<h2>${esc(L.appendix)}</h2>
${appendix}
<footer>diff ${esc(meta.hash)} · base ${esc(meta.base)} (${esc(meta.branch)}) · ${esc(L.generatedOn)} ${esc(meta.generated)} · explain-changes</footer>
</main>
<script>${JS}</script>
</body>
</html>
`;
}

const USAGE = 'usage: render_changes.mjs --brief <file.json> [--out <notebook-dir>] [--base <ref>]\n'
  + '       render_changes.mjs --hash [--base <ref>]';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--hash') { a.hash = true; continue; }
    if (k !== '--brief' && k !== '--out' && k !== '--base') return { error: `unknown argument ${k}` };
    const v = argv[++i];
    if (v === undefined) return { error: `${k} needs a value` };
    // A ref starting with "-" would reach git as an option.
    if (k === '--base' && v.startsWith('-')) return { error: `--base ${v}: not a ref` };
    a[k.slice(2)] = v;
  }
  return a;
}

/** Warn when a report lands where git could pick it up. Exit 1 = not ignored; 128 = outside. */
function ignored(root, file) {
  try { git(root, ['check-ignore', '-q', '--', file]); return true; } catch (e) { return e.status !== 1; }
}

export function run(argv, cwd = process.cwd()) {
  const fail = (code, msg) => ({ code, out: [], err: [`explain-changes: ${msg}`, ...(code === 2 ? [USAGE] : [])] });
  const a = parseArgs(argv);
  if (a.error) return fail(2, a.error);
  let root;
  try { root = git(cwd, ['rev-parse', '--show-toplevel']).trim(); } catch { return fail(2, 'not inside a git repository'); }
  const d = selectDiff(root, a.base);
  if (!d.text.trim()) return fail(3, 'nothing to explain — the diff is empty');
  const hash = diffHash(d.text);
  if (a.hash) return { code: 0, out: [hash], err: [] };
  if (!a.brief) return fail(2, '--brief <file.json> is required');
  let brief;
  try { brief = JSON.parse(fs.readFileSync(path.resolve(cwd, a.brief), 'utf8')); } catch (e) {
    return fail(2, `cannot read the brief: ${e.message}`);
  }
  const files = parseDiff(d.text);
  markGenerated(root, files);
  const problems = checkBrief(brief, files);
  const branch = gitOr(root, ['rev-parse', '--abbrev-ref', 'HEAD'], 'no-commit');
  const base = gitOr(root, ['rev-parse', '--short', a.base ?? 'HEAD'], 'none');
  const now = new Date().toISOString();
  const html = renderPage({ brief, files, problems,
    meta: { branch, mode: d.mode, hash, base, generated: now.slice(0, 16).replace('T', ' ') } });
  const dir = a.out
    ? path.resolve(cwd, a.out, 'changes')
    : path.resolve(root, git(root, ['rev-parse', '--git-dir']).trim(), 'explain-changes');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${now.slice(0, 10)}-${branch.replace(/[^\w.-]+/g, '-')}-${hash}.html`);
  fs.writeFileSync(file, html);
  const err = [];
  if (a.out && !ignored(root, file)) err.push(`explain-changes: warning — ${file} is not git-ignored, and the report contains code`);
  if (problems.length) {
    err.push(`explain-changes: ${problems.length} narrative mismatch(es) — fix the brief and re-run:`,
      ...problems.map((p) => `  - ${p}`));
  }
  return { code: 0, out: [file, `diff ${hash}`], err };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = run(process.argv.slice(2));
  if (r.out.length) process.stdout.write(`${r.out.join('\n')}\n`);
  if (r.err.length) process.stderr.write(`${r.err.join('\n')}\n`);
  process.exitCode = r.code;
}
