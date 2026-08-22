/**
 * `geneseed catalog` — the shipped roster, in a terminal.
 *
 * WHY THIS VERB IS NEW RATHER THAN PORTED. The reference had no `catalog` subcommand: the
 * same information existed only behind the web console's catalog endpoint and behind the
 * full-screen browse panel, so the one way to ask "what does this harness actually ship"
 * from a shell was to start a server. The endpoint's answer is the source of the fields
 * rendered here — name, one-line purpose, source file, lifecycle status, and a skill's
 * category — so this is a second FACE on one walk and not a second walk.
 *
 * THAT WALK IS `tuiInventory`, WHICH ALREADY HAD FOUR CALLERS and now has five. Nothing
 * about the classification lives here; a listing that re-derived "which files are agents"
 * would be the second classifier the inventory module's header exists to forbid.
 *
 * IT RETIRES THREE HELPERS THAT HAD NO PRODUCT CALLER. `tuiEntries`, `icon`/`fit`/`truncd`
 * and the display-width table under them were ported for a panel that was then dropped, and
 * were reachable only from their own gates. They are the right tools for this rendering
 * — `dwidth` is what keeps an emoji-bearing purpose line from breaking the column — so the
 * roster is built out of them rather than beside them. `detailLines` is NOT used and stays
 * uncalled: it renders a selected entry's whole body into a detail pane, which a listing
 * has no place for.
 *
 * NOTHING HERE PAINTS. No cursor moves, no clears, no alternate screen: this writes lines
 * and stops, exactly as `status` does. That is what keeps the dropped panel dropped.
 */
import { helpWidth } from '../ui/cli.mjs';
import { tuiInventory } from '../inspect/inventory.mjs';
import { defaultTheme, installedDefaults } from '../hosts/installs.mjs';
import { printOut } from '../lib/fs.mjs';
import { dwidth, fit, icon, truncd, tuiEntries } from '../ui/tui.mjs';

/**
 * The listing's section names, and the row kind each one selects.
 *
 * FIVE SINCE THE CONSTITUTION BECAME THREE TIERS, in constitutional order between the two
 * entity sections and after them — `ontology`, `laws`, `doctrines` read as one block. The
 * order here is only the no-section filter's; the printed order is `tuiEntries`'.
 *
 * ⚠ THE SET IS DECLARED IN TWO FILES AND `tests/unit/catalog.test.mjs` TIES THEM. The verb's
 * `section` positional takes its `choices` from `js/cli-table.json`, so a kind added here and
 * not there is a section the endpoint serves and the front door refuses. `catalog` has no
 * recorded help text and no golden cell, which is what makes the pair editable at all.
 */
export const CATALOG_KINDS = {
  agents: 'agent', skills: 'skill', ontology: 'ontology', laws: 'law', doctrines: 'doctrine',
};

/**
 * The badge column: what the catalog endpoint carries beside the name that is not the
 * purpose. An agent has a lifecycle status, a skill has that and a category, a law has a
 * governance class and no status at all — which is the endpoint's shape, not a shortcut.
 *
 * A doctrine rule's badge is its PACK plus whether this install built it in. The pack is
 * already the rule's class (there is no second taxonomy over a doctrine), and `off` is the
 * one thing a reader cannot infer from the row: an inactive pack is listed, not hidden, so
 * without the marker its rules read as binding. An ontology section has neither — it is a
 * worldview, not a rule list — and an empty badge collapses its column.
 */
function badgeFor(kind, data) {
  if (kind === 'ontology') return '';
  if (kind === 'doctrine') return `${data.klass ?? 'craft'}${data.active === false ? ' (off)' : ''}`;
  if (kind === 'law') return data.klass ?? 'craft';
  if (kind === 'skill') return `${data.klass ?? 'build'}/${data.status ?? 'unknown'}`;
  return data.status ?? 'unknown';
}

/**
 * The rendered roster as lines, with no trailing newline on any of them.
 *
 * A SECTION WITH NO ROWS PRINTS NO HEADING. The heading is emitted lazily, when the first
 * row that survives the filter arrives — so `catalog laws` on an install whose render
 * produced no laws is EMPTY rather than a heading over nothing, and the caller can tell the
 * two apart and say so.
 *
 * The name column is measured over the rows actually being printed, not over the whole
 * inventory: filtering to `agents` must not leave a gutter the width of the longest law
 * title. `dwidth` rather than `String.length`, because a purpose line can carry an emoji
 * and a status glyph is two columns wide in every tier but ASCII.
 */
export function catalogLines(inv, section, width, showSource = false) {
  const kinds = section ? [CATALOG_KINDS[section]] : Object.values(CATALOG_KINDS);
  const rows = tuiEntries(inv);
  const shown = rows.filter(([kind]) => kinds.includes(kind));
  if (!shown.length) return [];
  const cap = Math.max(12, Math.floor(width / 2));
  const nameW = Math.min(cap, Math.max(...shown.map(([, label]) => dwidth(label))));
  const badgeW = Math.max(...shown.map(([kind, , data]) => dwidth(badgeFor(kind, data))));

  const out = [];
  let pending = null;
  for (const [kind, label, data] of rows) {
    if (kind === 'head') { pending = label; continue; }
    if (!kinds.includes(kind)) continue;
    if (pending !== null) {
      if (out.length) out.push('');
      out.push(pending);
      pending = null;
    }
    // `source` is the endpoint's field and is an absolute path, so it replaces the purpose
    // column rather than joining it — two long strings on one line is a column layout that
    // is a wrapped mess on every terminal narrower than the sum of them.
    //
    // AND IT IS THE ONE COLUMN THAT IS NEVER TRUNCATED. A purpose line cut at the terminal
    // edge still reads; half a path is not a path, and the reason to ask for one is to hand
    // it to something else.
    const tail = showSource ? (data.source ?? '') : (data.desc ?? '');
    const row = `  ${icon(kind)} ${fit(label, nameW)}  ${fit(badgeFor(kind, data), badgeW)}  ${tail}`
      .replace(/\s+$/, '');
    out.push(showSource ? row : truncd(row, width));
  }
  return out;
}

/**
 * The verb.
 *
 * An unknown `--theme` is refused by `effectiveTheme` on the way through the render, with
 * the wording every other theme-taking verb already prints — so there is no second theme
 * validator here, and the entry point's `exitCode` arm carries the refusal out.
 */
export function cmdCatalog(args) {
  const inst = installedDefaults();
  const theme = args.theme || inst.theme || defaultTheme();
  // The install's own pack selection, so an inactive pack's rules are listed and MARKED
  // rather than listed as though they bind. `null` — no carrier said — reads as every pack.
  // `helpWidth()` is `COLUMNS`, else the terminal, else 80 — minus the two columns argparse
  // subtracts for its own layout. This listing wants the whole terminal, so it adds them
  // back rather than owning a second copy of that precedence chain.
  const lines = catalogLines(tuiInventory(theme, inst.doctrines), args.section,
    helpWidth() + 2, args.source);
  if (!lines.length) {
    printOut(`[catalog] nothing to list${args.section ? ` under ${args.section}` : ''}.\n`);
    return 1;
  }
  for (const line of lines) printOut(`${line}\n`);
  return 0;
}
