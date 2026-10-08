---
name: bruno-test
description: Write or update Bruno requests for the endpoints this iteration touched.
effect: mutate
skill: bruno
outcomes: pass, fail
---
Follow the bruno skill for every endpoint this iteration's diff added or changed.
Touch only the Bruno collection — new or updated `.bru` requests and their expectations — never
the application code.

Report `pass` once every touched endpoint has a request that exercises it and asserts on the
response.

Report `fail` if an endpoint cannot be exercised this way (missing auth fixture, no reachable
instance, an endpoint the diff removed), naming which one and why.
