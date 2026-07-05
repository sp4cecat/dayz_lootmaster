Run ESLint on the Lootmaster codebase.

Execute `npm run lint` in the project root. The config uses `@eslint/js`, `eslint-plugin-react-hooks`, and `eslint-plugin-react-refresh`.

Report all errors and warnings grouped by file. For each error, include the rule name so the fix is obvious. Common issues in this codebase:
- Missing `key` props in lists (react-hooks exhaustive-deps)
- `react-refresh/only-export-components` violations from utility exports mixed into component files
- Unused imports leftover from refactors

If the lint run exits non-zero, do not attempt auto-fixes unless the user explicitly asks — report findings first.
