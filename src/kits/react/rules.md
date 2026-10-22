### React kit

Applies to React 18 or 19 apps built with Vite or webpack, in TypeScript or JavaScript, tested with Jest and React Testing Library. Read `package.json` first and use only the APIs its React major provides.

- Function components and hooks only. No new class components, except an error boundary where the project has no library for it.
- Hooks at the top level only. Never disable `react-hooks/rules-of-hooks` or `react-hooks/exhaustive-deps` to make a warning go away.
- Derive values during render; never copy props or state into state through an effect. Every effect that subscribes cleans up.
- Server data goes through the project's server-state library, with loading, error and empty states.
- Keep each folder's language: TypeScript stays typed, with no `any` or `@ts-ignore` to get green; JavaScript stays JavaScript.
- Env values the bundler inlines (`import.meta.env.VITE_*`, webpack `DefinePlugin`) are public. No secret there, and no session token in `localStorage`.
- Interactive elements are native (`<button>`, `<a href>`, `<input>` with a label) and keyboard-reachable.
- Tests query by role or label and act with `userEvent`; the network is mocked with MSW, not by mocking the fetch client.
- Match the project's existing styling, state library and CI before introducing another.
