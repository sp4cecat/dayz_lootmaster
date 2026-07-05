Run TypeScript type-checking without emitting files.

Execute `npx tsc --noEmit` in the project root to get a full type error report across the codebase without producing any output files.

This is faster than a full build for catching type regressions. Report all errors grouped by file with line numbers. Pay special attention to:
- `src/types/loadouts.ts` — the `LoadoutNode` type is the core data model used by the Universal Hierarchical Editor; type narrowing errors here propagate widely
- `src/utils/xml.ts` — strict XML parse result types
- Component prop interfaces in `src/components/base/` — mismatches here break react-aria-components integration

Do not suggest using `as any` or `// @ts-expect-error` to silence errors unless the underlying type truly cannot be expressed.
