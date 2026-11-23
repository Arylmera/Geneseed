- **`geneseed export` no longer doubles the prefix.** With the prefix `geneseed-`, the review skill
  is exported as `geneseed-code-review` (it was `geneseed-geneseed-code-review`) and the harness
  skill as `geneseed`. A library that took the old names sees two renames at its next import. Two
  entities that would share one exported name are refused.
