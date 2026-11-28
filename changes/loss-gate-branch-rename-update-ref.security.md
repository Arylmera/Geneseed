- **The data-loss gate now covers renaming `main`, `update-ref` and `shred`.** `git branch -m main
  x` renamed the protected branch away, a forced `git branch -M`/`-C` onto it overwrote it, and
  `git update-ref` deleted or moved it, all without a question. Each now asks the way `branch -D`
  and `branch -f` already do: a move onto a protected branch asks only when it strands commits no
  remote holds. `shred` is read like `rm`. Overwriting a modified file in place (`> f`, `cp -f`,
  `sed -i`) still passes on purpose, because an Edit does the same thing unasked.
