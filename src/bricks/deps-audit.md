---
name: deps-audit
description: Audit this iteration's dependency changes for known vulnerabilities.
effect: read
skill: dependencies
outcomes: pass, fail
---
Follow the dependencies skill's audit against the dependency manifest this iteration's diff
touched (or the whole manifest, if nothing else scopes it). Never edit any file; this brick only observes.

Report `pass` if the audit finds nothing at high severity or above.

Report `fail` on any finding at high severity or above, naming the package, the version, the
advisory, and the fix the skill recommends (upgrade, pin, or removal).
