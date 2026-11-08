# {{SKILL}}: gitlab-ci

> {{DESC_GITLAB_CI}}

**Trigger:** writing, changing or debugging `.gitlab-ci.yml` or a file it includes: job conditions, stage order, `needs`, templates, caches, artifacts, CI/CD variables, environments and deployments, or a pipeline that does not start or runs the wrong jobs. Jenkins goes to the [jenkins-pipeline {{SKILL}}](jenkins-pipeline.md).

## Working loop
1. Read `.gitlab-ci.yml` and every `include:` it pulls, then the merged result: the pipeline editor's **Full configuration** tab, or `glab ci config compile`.
2. Lint before pushing: `glab ci lint`, or `POST /projects/:id/ci/lint` with `dry_run=true`. The dry run also evaluates `rules:` against a ref, which a plain syntax check does not.
3. Push to a branch and read the created pipeline: which jobs exist, which were skipped, and why.

## When a job runs: `rules:`
- Every condition is `rules:`. GitLab no longer actively develops the older keywords, and they cannot be combined with `rules:` in one job. <!-- banned: ok --> Neither `only:` nor `except:` appears in new or changed jobs; migrate a job you touch.
- Rules are checked in order and the first match wins: `- if: $CI_PIPELINE_SOURCE == "merge_request_event"`, `- if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH`, `- changes: [src/**/*]`, then `- when: never` or a final default.
- Stop duplicate branch and merge-request pipelines with a top-level `workflow: rules:` (the `$CI_OPEN_MERGE_REQUESTS` pattern), not with per-job tricks.
- `changes:` compares against the previous push on a branch pipeline; compare against the target branch with `changes: { paths: [src/**/*], compare_to: refs/heads/main }`.
- `when: manual` in a rule gives a manual job; add `allow_failure: true` unless it must block the pipeline.

## Order: stages and the `needs:` DAG
- `needs: [build]` starts a job as soon as `build` finishes, regardless of stage. `needs: []` starts it at once. Use it to put fast checks (lint, unit tests) first, ahead of slow stages.
- `needs:` also limits which artifacts are downloaded: `needs: [{ job: build, artifacts: true }]`. A job without `needs:` downloads every artifact of every earlier stage.
- A needed job skipped by its rules makes the pipeline invalid; mark it `optional: true` when the dependency is conditional.

## Reuse: `include:` and `extends:`
- `include:` brings shared files: `local:`, `project:` with a pinned `ref:` (a tag, never a moving branch), `component:` with a version, or `template:`.
- `extends: .base` merges a hidden job (a name starting with `.`) into this job. It merges hashes deeply and replaces arrays whole, so a job that extends one with `script:` and sets its own `script:` loses the base script.
- Prefer `extends:` to YAML anchors: anchors do not cross `include:` boundaries. `!reference [.setup, script]` reuses one key from another job.

## Caching and artifacts
- `cache:` speeds up later runs and may be missing; `artifacts:` passes files to later jobs and is guaranteed. Never put a build output that another job needs in a cache.
- Key a cache on the lock file: `cache: { key: { files: [package-lock.json] }, paths: [.npm/] }`. Use `policy: pull` in jobs that only read it.
- Give artifacts an `expire_in:`. Publish test results with `artifacts: reports: junit:`, under `when: always`, so a failed run still shows them.

## Variables and secrets
- Secrets live only in the project or group CI/CD settings: masked, protected, and in a scoped environment when they belong to one. Never in `.gitlab-ci.yml`, an included file or a commit.
- A protected variable is visible only to protected branches and tags. A merge-request job from a feature branch does not get it; that is the protection working, not a bug to remove.
- A masked value must meet GitLab's masking rules (length, characters); GitLab refuses to save a masked variable whose value fails them. Use a file-type variable for multi-line values such as keys.
- Masking is best-effort: it hides only the exact value. A transformed value (base64, a substring, a URL-encoded form) prints in clear.
- Do not `echo` a variable or run with `set -x` in a job that has secrets. `CI_DEBUG_TRACE` and `CI_DEBUG_SERVICES` dump every variable into the job log; never set them in a job that has secrets.
- Prefer OIDC (`id_tokens:`) to a long-lived cloud key when the target supports it.

## Images and versions
- Pin `image:` and `services:` to a version tag or a digest, never `latest`. Pin tool versions in the job (`npm ci`, a fixed CLI version), so a rerun next month runs the same thing.

## Environments and deployments
- A deploy job sets `environment: { name: production, url: ... }`, and production deploys are guarded by protected environments with required approval, not by a rule alone.
- `resource_group: production` stops two deploys to one environment from running at once.
- Review apps: `environment: { name: review/$CI_COMMIT_REF_SLUG, on_stop: stop_review, auto_stop_in: 1 week }` with a matching `stop_review` job (`when: manual`, `action: stop`).

## Done when
- The lint (with dry run) accepts the merged configuration, a real branch pipeline ran the expected jobs and skipped the others for the expected reason, and no job uses the older condition keywords.
