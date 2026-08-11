---
group: howto
order: 9
title: "The self-improvement loop"
kind: "concept"
link: {"hash": "#/diff", "label": "Open the diff page →"}
---
Local edits the agent makes to its own deployed agent/skill files survive the next rebuild. Before `setup`, re-theme, or `upgrade` overwrites them, any drift is auto-exported to a markdown **improvements file** under `improvements/` inside the deployed harness dir — untouched by rebuilds and uninstall. Hand it to an agent in *this* repo to back-port the changes into `src/`. On demand: `geneseed diff --out FILE`, or the **Changes** page in this UI.
