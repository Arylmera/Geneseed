---
group: reference
order: 1
title: "CLI — every subcommand"
kind: "cli"
section: "CLI & environment"
description: "Every geneseed subcommand, from the CLI's own table."
---
The console renders this page from `js/cli-table.json`, the CLI's own description of itself, so it is always in step with the installed version. Outside the console, `geneseed --help` lists every command and `geneseed <command> --help` describes one.

Kits and detection touch four commands. `setup` asks one question per kit and, for the `superpowers` kit, defaults by what it reads of your plugin settings; `setup --profile` and `profile apply` resolve a profile's `kitsByDetection` the same way. `rebuild-all`, `update` and `migrate` give an install built before the kit existed the kit again, unless the plugin is seen, and print one line per install saying which. `doctor` and `status` warn when the kit and the plugin are both on, or both off. Every line names the file it read ("seen in", or "not seen in"), because detection only reads files. See [the superpowers kit](../concepts/superpowers-kit.md).
