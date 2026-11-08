### CI pipelines kit

Applies to Jenkins pipelines (declarative `Jenkinsfile`, shared libraries) and GitLab CI (`.gitlab-ci.yml` and its includes). Read the pipeline file and everything it loads before changing it.

- One source of truth: the pipeline lives in the repository's pipeline file and the libraries or includes it pins. No job configured by hand in the CI's web UI, no second copy of a step in another file.
- Secrets come only from the CI's own store (Jenkins credentials, GitLab masked and protected variables). Never in the pipeline file, a commit, a parameter default or the build log.
- Pin images, tools and shared code: image tags or digests, never `latest`; a fixed tool version; a library or include at a tag, never a moving branch.
- Fast feedback first: lint and unit tests run early and in parallel; slow stages wait on them.
- GitLab job conditions use `rules:`; Jenkins logic beyond declarative syntax goes into a tested shared-library step.
- Lint the pipeline before pushing, then prove the change with a real branch run, read from its log.
