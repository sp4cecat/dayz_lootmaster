Run the Lootmaster test suite.

Execute `npm test -- --watch=false` in the project root. The suite uses **Vitest** with the `jsdom` environment (required because the app uses `DOMParser` for XML handling).

Key test areas:
- `src/utils/xml.ts` — XML round-trip parsing and generation
- `src/utils/validation.js` — CLE attribute validation against cfglimitsdefinition
- `src/hooks/useLootData.js` — data loading, merging, and IDB persistence logic

After the run, report: total tests, pass/fail counts, and the full output for any failures. If a test imports a path that doesn't resolve, check whether the file was recently renamed or whether a `.js` extension is needed in the import (Vite/ESM requires explicit extensions in some configurations).
