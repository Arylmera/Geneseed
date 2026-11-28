- **The Sealed Secrets scan now catches more key shapes.** A write containing an OpenAI key
  (`sk-proj-…`, `sk-svcacct-…`, or the legacy 48-character `sk-…`), a Google API key (`AIza…`), an
  npm token (`npm_…`) or a Stripe live key (`sk_live_…`, `rk_live_…`) asked nothing, and the activity
  log stored such a snippet unredacted. All three copies of the pattern (the hook, the OpenCode guard
  and the OpenCode learn plugin) now match them, each with a fixed prefix and a minimum length so
  prose and identifiers stay quiet.
