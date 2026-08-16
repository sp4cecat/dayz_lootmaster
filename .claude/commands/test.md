Run the Lootmaster test suite.

Execute `npx vitest run` in the project root (preferred — `npm test -- --watch=false` triggers a vitest CLI warning about forwarded flags). The suite uses **Vitest** with the `jsdom` environment (required because the app uses `DOMParser` for XML handling).

Key test areas:
- `src/utils/xml.ts` — XML round-trip parsing and generation
- `src/utils/validation.js` — CLE attribute validation against cfglimitsdefinition
- `src/hooks/useLootData.js` — data loading, merging, and IDB persistence logic
- `tests/server/cftools-*.test.js` — CF Tools proxy: auth serialization, TTL caching/stale-serve, GameLabs endpoint-path regressions (`npx vitest run tests/server` for just these)
- `tests/components/live-*.test.tsx`, `tests/components/raw-action-panel.test.tsx` — live map marker icons (asserted via `svg[data-icon]` + tint classes), side-panel footer, contextual GameLabs action filtering

After the run, report: total tests, pass/fail counts, and the full output for any failures. If a test imports a path that doesn't resolve, check whether the file was recently renamed or whether a `.js` extension is needed in the import (Vite/ESM requires explicit extensions in some configurations).
