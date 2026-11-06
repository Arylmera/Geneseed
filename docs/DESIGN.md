---
type: design-system
mirrors-commit: 9c4af014
generated: 2026-11-06
---

# Console design system

The design system of the `geneseed web` console, extracted from `web/src/styles.css`. Product
decisions are in the root [`DESIGN.md`](../DESIGN.md), and console behaviour in
[`web-ui.md`](web-ui.md).

<!-- geneseed:doc:start -->
## Principles

- **A developer terminal, not a marketing page.** Deep ink surfaces, mono chrome, one accent (`styles.css:1-5`).
- **Skins, not themes.** Four skins (`cultivar`, `operator`, `matrix`, `atlas`, `web/src/hooks/useFlavour.js`) redefine the same tokens on `.app`, each in dark and light. The accent follows the deployed theme.
- **Offline first.** Fonts are self-hosted through `@fontsource`; nothing loads from a CDN (`styles.css:19-22`).
- **Motion defers to the user.** Every JS animation passes `motionOK()` (`web/src/lib/motion.js`) and keeps its `settle()`, and CSS motion stops under `prefers-reduced-motion`.
<!-- geneseed:doc:end -->

<!-- geneseed:doc:start -->
## Tokens

Values are the `:root` defaults, before a flavour block overrides them. Each flavour's own values
are in its `.fl-*` block. Contrast is the WCAG 2.x ratio against `--bg` (`#08090B`).
`web/src/__tests__/contrast.test.js` gates AA on every flavour and surface.

### Colour

| Name | Value | Role | Contrast | Source |
|---|---|---|---|---|
| `--bg` | `#08090B` | Page background | — | `styles.css` `:root` |
| `--bg-2` | `#0C0E11` | Second background | — | same |
| `--surface` | `#101317` | Card | 1.07 | same |
| `--surface-2` | `#14181D` | Raised card | — | same |
| `--surface-3` | `#1B2026` | Highest surface | 1.22 | same |
| `--line` | `#2C333B` | Border | 1.56 (not text) | same |
| `--line-2` | `#3A434D` | Stronger border | 1.98 (not text) | same |
| `--line-3` | `#4C5762` | Strongest border | 2.70 (not text) | same |
| `--text` | `#EAEEF2` | Body text | 17.08 AAA | same |
| `--text-2` | `#9AA6B2` | Secondary text | 8.04 AAA | same |
| `--text-3` | `#727F8E` | Tertiary text | 4.88 AA | same |
| `--accent` | `#3AD4C4` | Accent, set at run time | 10.81 AAA | same |
| `--accent-2` | `#2BA89B` | Accent, second step | 6.81 AA | same |
| `--accent-ink` | `#04100D` | Text on a filled accent | 10.50 on `--accent` | same |
| `--good` | `#4ED888` | Success | 10.91 AAA | same |
| `--warn` | `#E8B53D` | Warning | 10.54 AAA | same |
| `--bad` | `#FF5C57` | Failure | 6.56 AA | same |
| `--bad-ink` | `#1A0605` | Text on a filled `--bad` | 6.45 on `--bad` | same |

### Typography

| Name | Value | Role | Source |
|---|---|---|---|
| `--font-display`, `--font-ui` | Hanken Grotesk, system-ui | Headings and interface | `styles.css` `:root` |
| `--font-mono` | Geist Mono, ui-monospace | Code, chips, figures | same |
| `--fs-2xs` … `--fs-2xl` | 11, 12, 13, 14, 17, 22, 28 px | Seven steps; 11 px is the floor, 28 px the page title | same |

### Spacing

| Name | Value | Role | Source |
|---|---|---|---|
| `--sp-1` … `--sp-8` | 4, 8, 12, 16, 20, 24, 32, 48 px | A 4 px grid | `styles.css` `:root` |
| `--rail-w`, `--topbar-h` | 248 px, 64 px | Shell. `--rail-w` must stay on `:root`, or the breakpoints stop winning | same |

Breakpoints are three, and only three: 1180, 960 and 720 px.

### Radius

| Name | Value | Role | Source |
|---|---|---|---|
| `--r-xs` … `--r-xl` | 4, 7, 11, 16, 22 px | Corners, small to large | `styles.css` `:root` |

### Shadow

| Name | Value | Role | Source |
|---|---|---|---|
| `--shadow-card` | `0 1px 0 rgba(255,255,255,.02) inset, 0 14px 40px -28px rgba(0,0,0,.9)` | Card | `styles.css` `:root` |
| `--shadow-pop` | `0 18px 50px -12px rgba(0,0,0,.7), 0 2px 0 rgba(255,255,255,.02) inset` | Popover | same |

### Motion

One scale, written once in `styles.css` `:root`. anime.js cannot read a CSS variable, so `DUR` in
`web/src/lib/motion.js` mirrors it, and `web/src/__tests__/motionTokens.test.js` fails when the two
part or a literal time or curve returns. The two exceptions: the reduced-motion stop (`.01ms`,
`.01s`), which is an off switch, and a negative `animation-delay`, which sets a loop's phase.
`linear` and `steps()` stay as they are: neither is a curve to tune.

| Name | Value | Role | Source |
|---|---|---|---|
| `--dur-0`, `--dur-1` | 20, 50 ms | Stagger steps; `--dur-1` also the shortest arc | `styles.css` `:root` |
| `--dur-2` … `--dur-5` | 100, 150, 200, 250 ms | Hover, press, colour | same |
| `--dur-6` … `--dur-8` | 300, 400, 500 ms | Expand, entrance, sweep | same |
| `--dur-9`, `--dur-10` | 700, 1000 ms | Count-up, ring sweep, one-shot flourish | same |
| `--dur-11` … `--dur-16` | 1500, 2500, 3000, 4000, 6000, 8000 ms | Ambient loops | same |
| `--dur-17`, `--dur-18` | 24, 40 s | Slow orbits | same |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | The console's settle; `EASE_OUT` (`outExpo`) in anime.js | same |
| `--ease-soft` | `cubic-bezier(.2,.7,.2,1)` | A gentler settle | same |
| `--ease-swing` | `cubic-bezier(.65,0,.35,1)` | Both ends eased, for a sweep | same |
| `--ease-fade`, `--ease-in` | `ease-out`, `ease-in` | Fades | same |
| `--ease-loop` | `ease-in-out` | Ambient loops | same |

### Layers

`--z-page` 1, `--z-sticky` 6, `--z-spotlight` 12, `--z-console` 20, `--z-tabbar` 25, `--z-scrim` 39,
`--z-drawer` 40, `--z-pop` 45, `--z-toast` 50, `--z-modal` 60, `--z-splash` 100. A new overlay picks a
layer, not a number.

### Drift

Pages still carry literal font sizes: 131 `font-size` declarations in `styles.css` use a number, not
a `--fs-*` token. The comment at the scale says they move one page at a time, not by codemod.
<!-- geneseed:doc:end -->

<!-- geneseed:doc:start -->
## Components

Shared primitives in `web/src/components/`.

| Component | Role | Variants and states | Key props |
|---|---|---|---|
| `PageHeader.jsx` | Page title block | With or without actions | title, children |
| `Tabs.jsx` | Sub-pages of a rail entry | Active tab | tabs |
| `DataTable.jsx` | Sortable data | Empty | columns, rows |
| `Stat.jsx`, `StatusBadge.jsx` | Figures and verdicts | good, warn, bad | value, label |
| `InstallPicker.jsx` | Names the install an action applies to, always as *Install:* | Hidden with one active install | installs, value, onChange |
| `EmptyState.jsx`, `ErrorState.jsx`, `Loading.jsx` | The three non-data states | Retry on error | message |
| `ConfirmDialog.jsx`, `Popover.jsx`, `Toast.jsx` | Overlays | Open, closed | children |
| `Spotlight.jsx`, `Search.jsx` | Jump to anything | `/`, Ctrl or ⌘ + K | — |
| `Markdown.jsx` | Rendered docs and rule text | — | text |

⚠ to confirm: the prop names above are summaries from reading the files, not a full contract.
<!-- geneseed:doc:end -->

<!-- geneseed:doc:start -->
## Usage rules

- **Do** use a surface and text token, so a flavour can restyle the page. **Do not** add a colour outside a flavour block; `contrast.test.js` reads the blocks.
- **Do** reuse one of the three breakpoints. **Do not** add a fourth.
- **Do** give a page's `InstallPicker` `className="page-pick"`: right above the heading of the view it acts on, labelled *Install:*: under the tabs on a tabbed page, over the h1 on a page with none. A form or popover that acts on its own install holds the same control inside it. **Do not** add a console-wide install switch, and **do not** write another label.
- **Do** read whether an install is on the shared tier from its `shared` field (`useInstalls`). State the shared scope once, in the page header, and tag a list head, not its rows. A project install's entry names its install.
- **Do** give each control one home. Skin and accent live in the Appearance popover, the lens in the Overview header, a kit's switches on the Kits page, a footprint in the Hosts panel. **Do not** add a second place that sets them.
- **Do** pass a JS animation through `motionOK()` and give it a settled end state.
- **Do** take a duration and a curve from the motion tokens. **Do not** write a literal one; pick the nearest step.
- **Do** show `Loading.jsx` while a first read is out, and print no count before its data. **Do not** let a pending read say it failed or found nothing.
- **Do** name an install with `installTag` and a host with `hostInfo().label`, and only where it differs.
- **Do** rebuild and commit `web/dist/` with every change under `web/src/`.
<!-- geneseed:doc:end -->

## Words

One word per concept. Every visible string uses the word in the middle column, and never one from
the right column. API fields, ids and CSS classes keep their own names: this table is about what a
person reads.

| Concept | Word | Never |
|---|---|---|
| A build against its source | *in sync*, *behind source*, *not checked* | in step, up to date |
| Geneseed against its release | *latest*, *N commits to pull*, *X available* | up to date |
| Files changed by hand in an install | *local edits*; a count reads *N edited* or *N local edits* | drift, drifted, hand edits, hand-edited, edited by hand, edits to graft |
| One copy of the harness on a host | *install* | harness (for a copy), deployed harness |
| What Geneseed makes, as a whole | *harness* | — |
| The tool an install lives in | *host*; its name is `hostInfo().label` | harness, in the Docs host switch |
| The agent's way of speaking | *voice* | theme |
| The console's look | *skin* | flavour, theme, direction |
| A way to lay out the Overview | *lens*: Overview, Genome, Greenhouse, HUD, Journal | a skin's name |
| A dive inside a lens | *sub-view*: Status, Lineage, Readout | a lens's or a skin's name |
| The numbered laws | the theme's noun `nouns.laws`, with *Dictates* as its fallback | Laws, in fixed prose |
| A rule named by the gate ledger | its principle; with no catalog entry, *Rule IV* or *Process rule 5* | `law-4`, `process.5` |
| Running the checks | *Run doctor*, on every button | Re-run checks |
| The tier's files | *shared* | global, on a row |

Keep the themed nouns the theme tokens own: a word that comes from `nouns` or a catalog title is
the voice's own and this table does not rule it.
