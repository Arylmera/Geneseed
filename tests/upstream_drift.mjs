#!/usr/bin/env node
/**
 * Upstream drift: has anything we CITE changed upstream since the commit we pinned?
 *
 * `src/upstreams.json` pins one commit per upstream; `{{CREDIT:key:path}}` tokens name the files
 * we adapted from it. A pin that silently ages means our adaptation misses upstream fixes, and
 * nothing else in the repo would notice. Weekly CI runs this and keeps ONE issue per drifted key.
 *
 * A key a VENDOR.md claims (`Upstream key:`) is compared only on the paths that VENDOR.md's own
 * `{{CREDIT:}}` tokens name (the vendored folder upstream) plus a root LICENSE file: the rest of
 * its repo is not ours. A VENDOR.md with no token still falls back to the whole repo.
 * An upstreams.json entry with `"frozen": true` is skipped: its text was pinned on purpose.
 *
 * `driftReport` is pure: `compare(repo, commit)` is injected (resolves to the changed file
 * paths since `commit`), so the unit test never touches the network.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { CREDIT_RE } from '../js/build/source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LABEL = 'upstream-drift';

/** @returns {Map<string, Set<string>>} key -> cited paths (empty set = VENDOR-only, no filter). */
export function scanCitedPaths(srcDir) {
  const cited = new Map();
  const add = (key) => cited.get(key) ?? cited.set(key, new Set()).get(key);
  const vendored = new Map(); // key -> the CREDIT paths of its VENDOR.md: they replace every other citation
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const text = fs.readFileSync(p, 'utf8');
        for (const m of text.matchAll(CREDIT_RE)) add(m[1]).add(m[2]);
        if (e.name === 'VENDOR.md') {
          for (const m of text.matchAll(/^- \*\*Upstream key:\*\*\s*(\S+)/gm)) {
            add(m[1]);
            vendored.set(m[1], new Set([...text.matchAll(CREDIT_RE)].filter((c) => c[1] === m[1]).map((c) => c[2])));
          }
        }
      }
    }
  };
  walk(srcDir);
  for (const [key, paths] of vendored) cited.set(key, paths);
  return Object.assign(cited, { vendored });
}

const touches = (file, p) => file === p || file.startsWith(p.replace(/\/$/, '') + '/');

/** @returns {Promise<{key:string, changed:string[], url:string}[]>} one row per drifted key. */
export async function driftReport(upstreams, citedPaths, compare) {
  const rows = [];
  for (const [key, up] of Object.entries(upstreams)) {
    const paths = citedPaths.get(key);
    if (!paths || up.frozen) continue; // not cited anywhere, or frozen on purpose: no drift to report
    const files = await compare(up.repo, up.commit); // sequential on purpose: API rate limits
    const licence = citedPaths.vendored?.has(key) && paths.size ? /^LICEN[CS]E[^/]*$/i : null; // vendored: its licence counts
    const changed = paths.size ? files.filter((f) => licence?.test(f) || [...paths].some((p) => touches(f, p))) : files;
    if (changed.length) rows.push({ key, changed, url: `https://github.com/${up.repo}/compare/${up.commit}...HEAD` });
  }
  return rows;
}

function api(token) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  return async (method, url, body) => {
    const res = await fetch(url.startsWith('http') ? url : `https://api.github.com${url}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
    });
    // A failed call must fail the run, or an outage reads as "no drift".
    if (!res.ok && !(method === 'GET' && res.status === 404)) {
      throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
    }
    return res.status === 404 ? null : res.json();
  };
}

/** Real `compare`: files changed between the pinned commit and HEAD. */
export function githubCompare(call) {
  return async (repo, commit) => {
    const data = await call('GET', `/repos/${repo}/compare/${commit}...HEAD`);
    if (!data) throw new Error(`${repo}: commit ${commit} not found`);
    // The API caps the list at 300 files; a truncated list could hide a cited change, and
    // "no drift" would then close the issue. Fail loud instead.
    if ((data.files?.length ?? 0) >= 300) throw new Error(`${repo}: compare truncated at 300 files, pin too old`);
    return (data.files ?? []).map((f) => f.filename);
  };
}

// shortcut: first page (100) of open drift issues only; upgrade past 100 drifted keys
export async function syncIssues(call, repo, upstreams, rows) {
  await call('POST', `/repos/${repo}/labels`, { name: LABEL, color: 'fbca04' }).catch((e) => {
    if (!String(e.message).includes('422')) throw e; // 422 = label already exists
  });
  const listed = await call('GET', `/repos/${repo}/issues?labels=${LABEL}&state=open&per_page=100`);
  const open = listed.filter((i) => !i.pull_request); // the issues endpoint also returns PRs
  const issueFor = (key) => open.find((i) => i.title.includes(`[${key}]`));
  const drifted = new Set(rows.map((r) => r.key));
  for (const r of rows) {
    const body = `Upstream moved past our pin.\n\n${r.url}\n\nCited files changed:\n${r.changed.map((f) => `- \`${f}\``).join('\n')}\n`;
    const existing = issueFor(r.key);
    if (existing) await call('PATCH', `/repos/${repo}/issues/${existing.number}`, { body });
    else await call('POST', `/repos/${repo}/issues`, { title: `Upstream drift [${r.key}]`, body, labels: [LABEL] });
  }
  // Close every open issue not matching a drifted key, orphans of removed keys included.
  for (const i of open) {
    if (![...drifted].some((k) => i.title.includes(`[${k}]`))) {
      await call('PATCH', `/repos/${repo}/issues/${i.number}`, { state: 'closed', state_reason: 'completed' });
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error('GITHUB_TOKEN is required'); process.exit(2); }
  const upstreams = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/upstreams.json'), 'utf8'));
  const call = api(token);
  const rows = await driftReport(upstreams, scanCitedPaths(path.join(ROOT, 'src')), githubCompare(call));
  console.log(rows.length ? rows.map((r) => `${r.key}: ${r.changed.length} changed ${r.url}`).join('\n') : 'no upstream drift');
  if (process.env.GITHUB_REPOSITORY) await syncIssues(call, process.env.GITHUB_REPOSITORY, upstreams, rows);
}
