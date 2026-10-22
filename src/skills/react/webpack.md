# {{SKILL}}: react — webpack

Configuration, client-side routing, environment variables and build failures for a React app on webpack. Check the webpack major in `package.json` first: webpack 5 removed the Node core-module polyfills and the `process` global that 4 shipped, and most config questions turn on that.

## Config
- The config is `webpack.config.*`, often split into `common`/`dev`/`prod` files joined with `webpack-merge`; edit the file the setting belongs to, not the merged result. Read the `build` and `start` scripts to see which file each loads.
- JSX and TypeScript go through `babel-loader` (`@babel/preset-react` with `runtime: 'automatic'`, `@babel/preset-typescript`), `ts-loader` or `swc-loader`; keep whichever the project has. A loader rule's `test` must match `.jsx`/`.tsx`, and `resolve.extensions` must list them.
- Path aliases are declared twice: `resolve.alias` in the webpack config and `paths` in `tsconfig.json` / `jsconfig.json` (or `tsconfig-paths-webpack-plugin` reads the second). Jest needs a third copy in `moduleNameMapper` (react-testing skill).

## Client-side routing
- With `BrowserRouter` (or any history-API router), the dev server needs `devServer.historyApiFallback: true`, or a refresh on `/users/42` is a 404. The production server needs the same fallback to `index.html`; that is server config, not webpack.
- Set `output.publicPath` to `'/'` (or the deploy sub-path). A relative public path makes chunks load from `/users/main.js` on a nested route.
- Split per route with `React.lazy(() => import('./pages/Users'))`; webpack turns each dynamic `import()` into its own chunk. Do not add an entry point per route to a single-page app.
- Dev API calls go through `devServer.proxy`, not a hard-coded backend URL in the code.

## Environment variables
- `process.env.X` in client code is not read at runtime: `DefinePlugin`, `EnvironmentPlugin` or `dotenv-webpack` replaces it with a literal at build time. Changing one means rebuilding, and every value is public. `mode` sets `process.env.NODE_ENV`.
- On webpack 5 an undefined `process.env.X` is `process is not defined` at runtime. Define the variable; do not add a `process` polyfill through `ProvidePlugin`.
- `.env.local` stays out of git. A per-environment value that must change without a rebuild comes from a runtime config file (`/config.json`) fetched at start.

## Type and lint checks
`babel-loader`, `swc-loader` and `ts-loader` with `transpileOnly` never type-check. Keep `tsc --noEmit` in the build script or CI (or `fork-ts-checker-webpack-plugin`), and ESLint with `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`.

## Build failures
Run the project's own `build` script, read the first error, fix only that, rebuild. One error at a time.

| Error | Cause | Fix |
|---|---|---|
| `Invalid hook call` | Two copies of React | `npm ls react` must show one; dedupe with `overrides`, or `resolve.alias` `react` to one path for a linked package. Module Federation: `shared: { react: { singleton: true }, 'react-dom': { singleton: true } }` |
| `Module not found: Can't resolve '@/...'` | Alias in tsconfig but not in webpack | Add it to `resolve.alias` |
| `Can't resolve './Button'` for a `.tsx` file | Extension not resolved | Add `.tsx`/`.jsx` to `resolve.extensions` |
| `Module parse failed: Unexpected token` on JSX | No loader matched the file | Widen the rule's `test`, or narrow an `exclude` that drops the folder |
| `BREAKING CHANGE: webpack < 5 used to include polyfills` | A dependency imports a Node core module | Prefer a browser build of the dependency; otherwise `resolve.fallback` with a named polyfill package |
| `process is not defined` | `process.env.X` not defined at build time | Add it to `DefinePlugin` / `EnvironmentPlugin` |
| 404 on refresh of a deep link | No history fallback | `devServer.historyApiFallback: true`, and the same fallback on the production server |
| Blank page on a nested route, chunk 404s | Relative `output.publicPath` | Set `output.publicPath: '/'` or the deploy sub-path |
| Works with `start`, broken after `build` | Dev and production configs differ | Build with `mode: 'production'` and serve `dist/` with a static server to reproduce |
| `ChunkLoadError` after a deploy | Browser holds the previous `index.html` | `[contenthash]` in chunk names, and serve `index.html` with `Cache-Control: no-cache` |

Never silence a build or type error with `// @ts-ignore`, `any` or a disabled lint rule; fix the cause or stop and report it.
