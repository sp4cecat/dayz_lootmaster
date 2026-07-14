# Linting the codebase

This project uses ESLint (v9, flat config) to keep the codebase consistent and catch issues early.

## Prerequisites
- Node.js and npm installed
- Project dependencies installed (`npm install`)

## Running the linter

```
npm run lint
```

This runs `eslint .` using the flat config in `eslint.config.js`.

## What is linted

- **`.js` / `.jsx`** — `@eslint/js` recommended rules plus the React Hooks and React Refresh plugins.
- **`.ts` / `.tsx`** — the same, extended with `typescript-eslint`'s recommended rules. `@typescript-eslint/no-unused-vars` and `no-explicit-any` are disabled here because `tsc` (`noUnusedLocals`/`noUnusedParameters`) already covers unused symbols and `any` is pervasive in this codebase; `react-refresh/only-export-components` is a warning rather than an error.

`dist/` is ignored globally.

## Type checking

ESLint does not type-check. Run the TypeScript compiler separately:

```
npm run typecheck   # tsc --noEmit
```

`npm run build` also runs `tsc --noEmit` before `vite build`, so type errors fail the build.
