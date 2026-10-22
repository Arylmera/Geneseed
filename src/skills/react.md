# {{SKILL}}: react

> {{DESC_REACT}}

{{CREDIT:everything-claude-code:skills/react-patterns/SKILL.md}}

**Trigger:** writing or changing React components, hooks, state or data fetching in a client-rendered app built with Vite or webpack, in TypeScript (`.tsx`) or JavaScript (`.jsx`). Load it for any React task, then read the side file the task needs. Tests go to the [react-testing {{SKILL}}](react-testing.md). Visual direction (palette, type, layout) belongs to the [frontend-design {{SKILL}}](frontend-design.md); this one owns how the components are built.

Target stack: React 18 or 19, Vite or webpack, TypeScript or JavaScript. Read `package.json` first: the React major decides which APIs exist (`use`, `useActionState`, `useOptimistic` and `ref` as a plain prop are React 19 only). No Server Components and no `"use server"`: a client-rendered SPA has no server render. The bundler is the one `package.json` depends on and the `build` script calls; read its side file, never the other's.

## Working loop
1. Read `package.json`, the bundler config (`vite.config.*` or `webpack.config.*`), `tsconfig.json` or `jsconfig.json`, and the ESLint config. Match the language of the folder you are in: a `.jsx` folder stays JavaScript unless the task is the migration.
2. Find the nearest existing component that does something similar and follow its structure, styling approach and state library before adding another.
3. Implement, then run the project's own lint, typecheck (when TypeScript) and test scripts and read the output. Neither `vite build` nor a transpile-only webpack loader type-checks; `tsc --noEmit` is a separate step.

## Rules of the render
- Render is a pure function of props and state. No fetch, subscription, timer or mutation in the render body.
- Derive, do not sync: a value computable from props or state is computed during render, never copied into state by a `useEffect`.
- An effect is for synchronising with something outside React (a subscription, a DOM API, a timer). Every effect that subscribes returns its cleanup; a fetch in an effect takes an `AbortController`.
- Never mutate state: `setItems(prev => [...prev, x])`, not `items.push(x)`. Use the functional updater when the next state depends on the previous one.
- Hooks at the top level only, never behind a condition, loop or early return. A custom hook starts with `use`; extract one when two components repeat the same hook sequence.
- `key` is a stable id from the data, never the array index of a list that reorders, inserts or deletes.
- Reset a component's state on identity change with `key={id}` on it, not an effect that watches the prop.

## Where state lives

| Used by | Put it in |
|---|---|
| One component | `useState` / `useReducer` inside it |
| A parent and a few children | the nearest common parent, passed down |
| Distant branches, rarely changing (theme, user, locale) | a Context, one per concern |
| Shared and changing often | the store the project already uses (Redux Toolkit, Zustand, ...) |
| Data from the server | the project's server-state library (TanStack Query, SWR, RTK Query) |

Do not add a global store or a context for state one subtree owns.

## Data fetching
- Use the project's server-state library; it gives caching, retries, cancellation and loading/error states. `useEffect` + `fetch` for application data races and has none of those.
- Every request has a loading, an error and an empty state in the UI.
- Put an error boundary (`react-error-boundary`, or the project's own) around each independently failing region, and `Suspense` close to the data, not only at the route root.

## TypeScript and JavaScript
- TypeScript: type props with an explicit `type Props = {...}`; no `any`, no non-null `!` to silence a check; type event handlers from React (`React.ChangeEvent<HTMLInputElement>`). Do not annotate return types as `React.FC`.
- JavaScript: keep the file JavaScript; document a non-obvious prop shape with JSDoc. Do not add PropTypes to a project that does not use them.

## Performance
Measure before memoising. `React.memo`, `useMemo` and `useCallback` only when the React DevTools profiler or a memoised child's dependency shows the cost. Lazy-load routes with `React.lazy` + `Suspense`. Virtualise lists past a few hundred non-trivial rows.

## Security
- `dangerouslySetInnerHTML` only with a sanitiser (DOMPurify) at the same call site.
- A URL from user data in `href` or `src` is checked for an `http(s):` scheme first.
- No session token in `localStorage`; it is readable by any injected script.
- Every env value the bundler inlines is public in the bundle (`import.meta.env.VITE_*` on Vite, `process.env.*` defined by webpack's `DefinePlugin`); never put a secret there.

## Side files
- **Vite project: config, env variables, aliases, proxy, build failures** -> read [react/vite.md](react/vite.md) and follow it.
- **webpack project: config, client-side routing, env variables, aliases, proxy, build failures** -> read [react/webpack.md](react/webpack.md) and follow it.
- **Accessibility: forms, keyboard, focus, ARIA, modals** -> read [react/a11y.md](react/a11y.md) and follow it.

## Done when
- Lint, typecheck (TypeScript projects) and tests pass, read from real output; the hooks lint rules are not disabled; every new interactive element is reachable by keyboard and labelled.

<!-- INCLUDE: skills/_self-improvement.md -->
