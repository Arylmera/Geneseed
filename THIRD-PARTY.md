# Third-Party Notices

Geneseed is licensed MIT (see [`LICENSE`](LICENSE)). It additionally **vendors** the
third-party components listed below. Each retains its own license; the MIT license of
Geneseed does **not** apply to them. Inclusion here is a license-preserving *aggregate*
(GPL-3.0 §5): the components sit as separate documentation files, are not combined into
or linked against Geneseed's own code, and travel with their own license text.

---

## cmux agent skills

- **Vendored at:** `src/skills/cmux/`, `src/skills/cmux-workspace/`
  (rendered into the harness bundle's `skills/` under the `files` emit).
- **Upstream:** [`manaflow-ai/cmux`](https://github.com/manaflow-ai/cmux) — `skills/cmux/`
  and `skills/cmux-workspace/`.
- **Pinned commit:** `62a52ede2bb1245da1fb9431abdfd5b0a0049e5d`.
- **License:** **GNU General Public License v3.0 or later (GPL-3.0-or-later)**,
  © 2024-present Manaflow, Inc. Full text in
  [`src/skills/cmux/LICENSE`](src/skills/cmux/LICENSE) and
  [`src/skills/cmux-workspace/LICENSE`](src/skills/cmux-workspace/LICENSE).
  Manaflow also offers a commercial license for organizations that cannot comply with the
  GPL — contact `founders@manaflow.com`.
- **Modifications:** none. The skill folders are copied **verbatim**. Their internal
  cross-links to cmux skills that are *not* vendored here (`cmux-settings`, `cmux-browser`,
  `cmux-markdown`) are left intact and resolve only against a full cmux checkout; in the
  Geneseed bundle they are dangling pointers and are exempt from the harness hermeticity /
  dead-link check (`build.is_vendored_path`).

These skills teach an agent the verified `cmux …` CLI surface (`cmux identify`,
`new-pane`, `move-surface`, `set-status`, `set-progress`, `send`, …) and the
`CMUX_WORKSPACE_ID` / `CMUX_SURFACE_ID` / `CMUX_SOCKET_PATH` environment anchors for
non-disruptive automation inside a cmux workspace.

### Updating

Re-sync from upstream with a sparse checkout, then bump the pinned commit above:

```sh
git clone --depth 1 --filter=blob:none --sparse https://github.com/manaflow-ai/cmux.git
cd cmux && git sparse-checkout set --skip-checks skills/cmux skills/cmux-workspace LICENSE
# copy skills/cmux, skills/cmux-workspace into Geneseed/src/skills/ (keep each LICENSE)
```
