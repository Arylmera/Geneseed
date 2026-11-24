- **A loop no longer pushes onto a PR that has auto-merge armed.** Before every push, the `loop`
  skill (and a factory run's loop and close push) asks the forge whether an open PR from the loop
  branch has auto-merge armed: `gh pr list --head loop/<slug>` on GitHub, `glab mr list
  --source-branch loop/<slug>` on GitLab. Such a PR merged each push as soon as its checks passed,
  with no human review. An armed PR stops the loop before the push, with the commit kept local, and
  so do a missing or signed-out `gh`/`glab`, a remote on another forge, and an answer the agent
  cannot read. A loop now needs `gh` or `glab`. Run `geneseed rebuild-all` to install the new skill.
