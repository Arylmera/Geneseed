# {{SKILL}}: jenkins-pipeline

> {{DESC_JENKINS_PIPELINE}}

**Trigger:** writing, changing or debugging a `Jenkinsfile` or a Jenkins shared library (`vars/`, `src/`, `resources/`): stages, agents, `when`, `parallel`, credentials, sandbox or script-approval errors, a `NotSerializableException`, or a JenkinsPipelineUnit test. GitLab CI goes to the [gitlab-ci {{SKILL}}](gitlab-ci.md).

## Working loop
1. Read the `Jenkinsfile`, the `@Library` lines it loads and the library's version pin, and the plugins it calls (`withCredentials`, `junit`, `stash`). A step from a plugin the controller lacks fails at run time, not at parse.
2. Find the nearest existing stage or library step that does something similar and follow it.
3. Validate the syntax before pushing: the controller's linter (`curl --user "$JENKINS_USER:$JENKINS_API_TOKEN" -X POST -F "jenkinsfile=<Jenkinsfile" $JENKINS_URL/pipeline-model-converter/validate`, the user and API token read from the credential store or a local secret, never typed into the command, or the `declarative-linter` CLI command), then the library's unit tests.
4. Push to a branch and read the real build log. A green lint proves syntax, not behaviour.

## Declarative first
- Write `pipeline { }` declarative. Use `script { }` only for logic declarative cannot express, and keep it short; move anything longer into a library step.
- Set `options { timeout(...); disableConcurrentBuilds(); buildDiscarder(logRotator(...)) }` on every pipeline. A build with no timeout can hold an executor forever.
- `agent none` at the top when stages need different agents; give each stage its own `agent` (label, `docker { image 'maven:3.9.9-eclipse-temurin-21' }`, or `kubernetes`). Pin the image tag.
- `post { always { junit ...; archiveArtifacts ... } failure { ... } }`: publish results in `always`, so a failed test run still shows its report.
- `when { branch 'main' }`, `when { changeRequest() }`, `when { changeset 'docs/**' }`, `when { expression { ... } }`. Add `beforeAgent true` so a skipped stage does not allocate an agent first.
- `parallel { stage('unit') {...} stage('lint') {...} }` for independent checks; add `failFast true` when one failure makes the others useless. Fast checks run first, as their own stage.

## Credentials
- Secrets come only from the Jenkins credential store, through `environment { TOKEN = credentials('id') }` or `withCredentials([string(credentialsId: 'id', variable: 'TOKEN')]) { ... }`. Never a literal, never a parameter default.
- Pass a secret to the shell through the environment, in single quotes: `sh 'curl -H "Authorization: Bearer $TOKEN" ...'`. Groovy interpolation (`sh "... ${TOKEN}"`) writes the secret into the script text, so it shows in the process arguments (`ps`) of the agent; Jenkins warns about it. `sh` runs with `-x` by default, and log masking hides only the exact secret string, so a transformed value (base64, a substring) prints in clear.
- Never `echo` a credential or write it to a workspace file that gets archived.

## Shared library layout
| Folder | Holds |
|---|---|
| `vars/<step>.groovy` | global steps: a `def call(Map args)` the Jenkinsfile calls as `step(...)`; an optional `vars/<step>.txt` documents it |
| `src/<package>/` | Groovy classes, imported with `import org.acme.Build` |
| `resources/` | non-Groovy files, read with `libraryResource 'org/acme/script.sh'` |

- Load it pinned: `@Library('acme-lib@v2.3.1') _`. A floating branch makes every build depend on whatever the library is today.
- A class in `src/` that runs pipeline steps takes the script context (`this`) in its constructor and calls `steps.sh(...)`; it has no `sh` of its own.
- Keep `vars/` steps thin: argument checks and a call into `src/`, which is where the tests point.

## CPS and `@NonCPS`
- Pipeline Groovy runs CPS-transformed so it can survive a controller restart; every local variable alive across a step must be serialisable. A `Matcher`, an `Iterator` or a JSON slurper result held across `sh` throws `NotSerializableException`.
- Fix: move the computation into a `@NonCPS` method that takes plain values and returns plain values (String, List, Map). A `@NonCPS` method must not call a pipeline step (`sh`, `echo`, `node`); it runs outside CPS and the step misbehaves.
- Prefer `readJSON` / `readYaml` (Pipeline Utility Steps) to `JsonSlurper`; they return serialisable maps.
- `sort` with a closure comparator gives wrong results under CPS: sort inside a `@NonCPS` method. `each` and `collect` closures work.

## Sandbox and script approval
- A Jenkinsfile runs in the Groovy sandbox. `RejectedAccessException: Scripts not permitted to use method ...` means the call needs approval.
- Do not ask for a broad approval (`java.lang.Runtime`, `getClass`, `staticMethod ... exec`) to get green. Rewrite with a pipeline step or move the code into a trusted shared library that an admin configured as global and reviewed.
- Code in a trusted global library runs outside the sandbox; review it as privileged code.

## Testing with JenkinsPipelineUnit
- Test library steps and Jenkinsfiles with `com.lesfurets:jenkins-pipeline-unit` on JUnit, extending `BasePipelineTest`.
- In `setUp()`: `super.setUp()`, build the library with `library().name('acme-lib').retriever(localSource('build/libs/')).targetPath('<notNeeded>').defaultVersion('master').build()` (`localSource` reads `<dir>/<name>@<version>`), pass it to `helper.registerSharedLibrary(...)`, and add `helper.registerAllowedMethod('sh', [Map]) { m -> ... }` for each step the code calls.
- Assert on what a caller sees: `helper.callStack` holds each step call with its arguments, and `assertJobStatusSuccess()` / `assertJobStatusFailure()` the result. Use `printCallStack()` while writing the test, not as the assertion.
- Every branch of a `when` or an `if` in a library step gets a case: one that runs it and one that skips it.
- `BasePipelineTest` does not run CPS. The experimental `BasePipelineTestCPS` checks serialisability at each step and catches most `NotSerializableException`s early, but its serialisation is not Jenkins's own: a real build still has the last word.

## Done when
- The linter accepts the file, the library tests pass, and a real branch build ran the changed stages, read from its log; no credential appears in that log.
