---
name: ci-fix
description: Fix the failing CI check named in the card.
effect: mutate
skill: ci-fix
outcomes: pass, fail
---
Follow the ci-fix skill against the failing check the card names — read its actual log, not a
guess from the check's title, before changing anything.

Touch only what that failure requires; this is a repair, not a chance to improve the pipeline
along the way.

Report `pass` once the named check is fixed and green.

Report `fail` if the check cannot be fixed from this repo alone (an infra outage, a flake with no
reproducible cause, a required secret that is missing), naming why.
