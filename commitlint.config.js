// Conventional Commits, checked on the PR TITLE in CI — a PR is squash-merged, so its title is
// the commit subject that lands on main. Two rules of the stock preset are relaxed, both because
// this repo's real subjects broke them for good reasons, measured over the last 80 on main:
// - `subject-case`: a subject names things — Markdown, AsciiDoc, C4, Loops › Active — and the
//   preset reads a leading proper noun as sentence case.
// - `header-max-length`: 100 cut real titles that list what a release-sized PR fixes; 120 still
//   catches a paragraph pasted into the title.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
  },
};
