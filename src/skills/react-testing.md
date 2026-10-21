# {{SKILL}}: react-testing

> {{DESC_REACT_TESTING}}

{{CREDIT:everything-claude-code:skills/react-testing/SKILL.md}}

**Trigger:** writing or fixing tests for React components, hooks or pages in a Vite project tested with Jest and React Testing Library, in TypeScript or JavaScript; or getting Jest to run at all against Vite-shaped code. React-specific; core test discipline lives in the develop skill. End-to-end flows across pages belong to the project's browser tests (Playwright, Cypress), not here.

Target stack: Jest, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, MSW for network mocks, `jest-axe`.

## What a test does
Render the component with the providers it has in production, act through `userEvent` the way a user would, assert what the user sees or what leaves the component (a callback called, a request sent). Never assert on internal state, hook calls, props passed to children, or render counts. Never mock React.

## Queries, in this order
1. `getByRole(..., { name })`, `getByLabelText`: what assistive technology sees. A test that cannot find the button by role has found an accessibility bug.
2. `getByText`, `getByDisplayValue`, `getByAltText`.
3. `getByTestId`: last resort.

`getBy*` throws when missing; `queryBy*` returns `null` (assert absence); `findBy*` waits (things that appear after async work). No `container.querySelector`.

## Interaction and async
```tsx
test('saves the email', async () => {
  const user = userEvent.setup();
  const onSave = jest.fn();
  render(<EmailForm onSave={onSave} />);

  await user.type(screen.getByLabelText('Email'), 'a@example.com');
  await user.click(screen.getByRole('button', { name: /save/i }));

  expect(onSave).toHaveBeenCalledWith('a@example.com');
});
```
- `userEvent.setup()` once per test, every call awaited. `fireEvent` only for an event `userEvent` cannot produce.
- Wait with `findBy*` or `waitFor`; never `setTimeout` or a sleep. With `jest.useFakeTimers()`, pass `userEvent.setup({ advanceTimers: jest.advanceTimersByTime })`.
- An `act(...)` warning is a real bug (an update after the test ended or an unawaited promise); fix it, do not silence `console.error`.

## Network with MSW
Mock at the network layer, so the fetch client and the server-state library run as in production. Start the server in the setup file with `onUnhandledRequest: 'error'`, `resetHandlers()` after each test, override per test with `server.use(...)`. Each test covers the error and empty responses, not only success.

## Providers
One `renderWithProviders` in a test-utils file wraps the router (`MemoryRouter`), the store and the query client. Create a fresh query client per test with `retry: false`, so cache and retries never leak between tests. Hooks: `renderHook` from `@testing-library/react`, with the same wrapper.

## Accessibility
`expect(await axe(container)).toHaveNoViolations()` (`jest-axe`) on every interactive component. jsdom has no layout: contrast and focus visibility need a browser.

## Jest in a Vite project
Vite and Jest resolve code differently; each gap is configured once in `jest.config.*`:

| Gap | Fix |
|---|---|
| No DOM | `testEnvironment: 'jsdom'` with `jest-environment-jsdom` installed; with MSW 2 use `jest-fixed-jsdom`, which keeps Node's `fetch` globals |
| JSX / TS not transformed | `babel-jest` with `@babel/preset-env`, `@babel/preset-react` (`runtime: 'automatic'`), `@babel/preset-typescript`; or `ts-jest` / `@swc/jest`, whichever the project has |
| `import.meta.env` is a syntax error | Read env in one module (`src/config/env.ts`) and replace it in tests via `moduleNameMapper` or `jest.mock`; do not scatter `import.meta.env` |
| Path aliases (`@/...`) | Mirror Vite's `resolve.alias` in `moduleNameMapper` |
| CSS and asset imports | `identity-obj-proxy` for CSS modules, a file stub for images and SVG |
| ESM-only package in `node_modules` | Let it through `transformIgnorePatterns: ['node_modules/(?!(pkg-a|pkg-b)/)']` |
| `toBeInTheDocument` undefined | `import '@testing-library/jest-dom'` in a `setupFilesAfterEnv` file |

## Snapshots
No snapshots of rendered components: they break on every markup change and get approved unread. Snapshot only a pure data serialiser.

## Done when
- The new tests fail without the change and pass with it; the project's test script passes, read from real output; no `act` warning, no unhandled MSW request, no skipped test left behind.

<!-- INCLUDE: skills/_self-improvement.md -->
