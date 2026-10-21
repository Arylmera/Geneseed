# {{SKILL}}: react — Vite

{{CREDIT:everything-claude-code:skills/vite-patterns/SKILL.md}}

Configuration, environment variables and build failures for a React app on Vite. Check the Vite major in `package.json` before reaching for an option; config keys move between majors.

## Config
- One `vite.config.ts` (or `.js`) with `defineConfig`. React support is `@vitejs/plugin-react` or `@vitejs/plugin-react-swc`; keep whichever the project has.
- Path aliases are declared twice: `resolve.alias` in the Vite config and `paths` in `tsconfig.json` / `jsconfig.json` (or the `vite-tsconfig-paths` plugin reads the second). Jest needs a third copy in `moduleNameMapper` (react-testing skill).
- Dev API calls go through `server.proxy` (`'/api': { target: 'http://localhost:8080', changeOrigin: true }`), not a hard-coded backend URL in the code.

## Environment variables
- Client code reads `import.meta.env.VITE_*`. Only `VITE_`-prefixed variables reach the bundle, and they are inlined at build time: changing one means rebuilding, and every value is public.
- `process.env` does not exist in client code; do not add a polyfill to make it work.
- `.env.local` and `.env.*.local` stay out of git. A per-environment value that must change without a rebuild comes from a runtime config file (`/config.json`) fetched at start, not from `VITE_*`.
- TypeScript: declare the variables in `src/vite-env.d.ts` (`interface ImportMetaEnv { readonly VITE_API_URL: string }`).

## Type and lint checks
`vite build` transpiles but never type-checks. Keep `tsc --noEmit` (or `tsc -b`) in the build script or CI, and ESLint with `eslint-plugin-react-hooks` (`rules-of-hooks`, `exhaustive-deps`) and `eslint-plugin-jsx-a11y`.

## Build failures
Run the project's own `build` script, read the first error, fix only that, rebuild. One error at a time.

| Error | Cause | Fix |
|---|---|---|
| `Invalid hook call` | Two copies of React | `npm ls react` must show one; dedupe with `overrides` in `package.json` |
| `Element type is invalid ... got: undefined` | Default vs named import mismatch | Match the import to the component's export |
| `Cannot find module 'react'` types (TS) | `@types/react` missing or a different major than `react` | Install the matching `@types/react` and `@types/react-dom` |
| `Failed to resolve import "@/..."` | Alias in tsconfig but not in Vite | Add it to `resolve.alias` or use `vite-tsconfig-paths` |
| `require is not defined` / CJS-only dependency errors | CommonJS dependency in the ESM pipeline | Add it to `optimizeDeps.include`; prefer an ESM build of the library |
| Works in `vite dev`, broken after `vite build` | Dev serves unbundled modules | Reproduce with `vite build && vite preview`, not dev |
| Blank page or 404 on assets after deploy | App served from a sub-path | Set `base` to that path |
| Old chunk 404 after a deploy | Browser holds the previous `index.html` | Serve `index.html` with `Cache-Control: no-cache`; hashed assets can stay immutable |

Never silence a build or type error with `// @ts-ignore`, `any` or a disabled lint rule; fix the cause or stop and report it.
