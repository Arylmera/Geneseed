# {{SKILL}}: deck

> {{DESC_DECK}}
<!-- aliases: slides, presentation -->

**Trigger:** the user asks for a presentation, slides or a deck without naming a file format.
An explicit `.pptx` request belongs to the host's pptx skill. To change an existing deck, edit
its HTML file in place rather than regenerating it.

## Procedure
1. **Interview, one question at a time**, each with a recommended default the user can accept
   with "ok": subject and source; audience (technical peers); goal — inform, convince, train,
   report (inform); length as duration or slide count (~10); style — sober, editorial, dark
   technical, playful, or an imposed brand's colours and logo (sober, follows system light/dark);
   usage — projected live, read alone, or both (both); speaker notes (no); PDF export (yes);
   density (from usage: projected 1-3 bullets a slide, read alone 4-8); a browser render check
   (only if asked). Given a source or outline, skip what it answers, batch the rest in one
   message, and go to step 2.
2. **Propose the outline** — parts and one line per slide — and generate only once the user
   validates or corrects it. Write the slides in the user's language unless asked otherwise.
3. **Write the whole deck by hand as ONE self-contained file** — no bundled shell, no CDN, no
   external script; all CSS and JS inline:
   - A fixed 1920x1080 stage scaled uniformly to the window, letterboxed, never reflowed; each
     slide a `<section>` with that fixed size, never `height: auto`. Inactive slides hidden with
     `visibility`/`opacity`, not layout tricks.
   - Keys ←/→, Space, PageUp/PageDown, Home/End, and touch swipe; the URL hash `#N` tracks the
     slide, with back/forward working.
   - `@media print` plus `@page` size so each slide prints as one page (`@page` size is Baseline
     2024; animations never reach the PDF).
   - Speaker notes in `<aside class="notes">`, hidden, toggled with N.
   - A system font stack; a web font only with a system fallback, so the deck degrades offline.
   - Diagrams as inline SVG; raster images base64 only when small (base64 adds ~33%).
   - Colours as `:root` variables with a `prefers-color-scheme: dark` set and checked contrast;
     one real heading per slide in a sane order; `prefers-reduced-motion` honoured; animations
     off unless asked for.
   - Palette, type and avoiding templated defaults: follow the
     [frontend-design {{SKILL}}](../{{DIR_SKILLS}}/frontend-design.md) — not repeated here.
4. **Write** `<slug>.html` in the working directory unless the user gives a path; ask before
   overwriting an existing file. Open it in the default browser with the platform's opener
   (`open`, `xdg-open`, or `start ""` on Windows).
5. **Verify.** By default, hold every slide to the density limit and say plainly that the render
   was not checked. Only on request, open the deck in a browser the host offers (Chrome MCP,
   Orca browser, Playwright) and run this — it works because inactive slides keep their layout:
   ```js
   [...document.querySelectorAll('section')].map((s, i) => [i + 1, s])
     .filter(([, s]) => s.scrollHeight > s.clientHeight || s.scrollWidth > s.clientWidth)
     .map(([i]) => i)
   ```
   Fix each flagged slide and re-run, two repair rounds at most ({{DOCTRINE:bound-the-loop}}).
6. Reply in one line: the file, slide count, ←/→ to move, N for notes, Ctrl+P for PDF.

## Done when
- One offline HTML file opens in the browser, navigates by key, swipe and hash, prints one slide
  per page, and the reply states whether the render was checked.

<!-- INCLUDE: skills/_self-improvement.md -->
