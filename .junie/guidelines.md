# Lootmaster – Project Guidelines for Advanced Contributors

This document captures project-specific knowledge to accelerate development and debugging. It focuses on how this repo is wired (build, server, data layout), how tests are set up and verified, and implementation nuances that matter when changing logic.

Last verified on: 2025-11-04


## 1) Build and Configuration

- Tooling
  - Vite 7 with @vitejs/plugin-react; React 19 ESM project ("type": "module").
  - ESLint is enabled with recommended + react-hooks + react-refresh rules.
  - Vitest 2 (jsdom environment) for tests.
  - Server dependency: moment (used in server/index.js for date/time parsing and formatting)
  - UI date/time controls: react-datetime-picker (+ react-calendar, react-clock) for ADM and stash report date range pickers
- Node version
  - Use a modern LTS Node (18+). The project is ESM and uses native fetch/DOM shims in tests via jsdom.
- Install
  - npm ci (preferred) or npm install
- Dev server (frontend)
  - npm run dev
  - Vite serves the React UI (default port is Vite’s standard unless overridden). The Vite config sets base: './' so assets are referenced relatively.
- Production build
  - npm run build → outputs to dist/
  - npm run preview → serves the built app locally to validate the build
- Backend data server (XML persistence API)
  - Minimal Node HTTP server at server/index.js. Start as:
    - node server/index.js
    - Environment:
      - PORT: default 4317
      - DATA_DIR: default ./data (absolute or relative path).
    - CORS is open (Access-Control-Allow-Origin: *). Frontend and server can run on different ports during development.
  - Data layout expectations:
    - cfglimitsdefinition.xml lives under DATA_DIR.
    - cfgeconomycore.xml under DATA_DIR governs how types are organized into groups/folders.
    - Types files are under DATA_DIR/db/types/<group>/<file>.xml
  - The server parses cfgeconomycore.xml to cache:
    - group → folder path
    - group → declared types file names (only <file type="types"/> entries)


## 2) Testing – Configuration and Usage

- Framework: Vitest 2, configured in vitest.config.js with environment: 'jsdom' and globals: true. DOMParser is available in tests via jsdom, enabling XML parsing without extra polyfills.
- Commands
  - Watch mode (default): npm test
  - One-off run: npx vitest run (or npm run test -- --run)
- Location and naming
  - Tests live under tests/** and can use .test.js or .spec.js. ESM imports only.
- Assertions
  - Use vi/describe/it/expect from vitest. No extra assertion libs are used.
- JSDOM notes
  - DOM APIs used in src/utils/xml.js (DOMParser) work under jsdom. If you add APIs not provided by jsdom, you may need to polyfill them in tests.
- Linting in tests
  - ESLint rule 'no-unused-vars' is strict but allows ALL_CAPS or leading underscore patterns via varsIgnorePattern: '^[A-Z_]'. Prefer not to suppress warnings; keep tests minimal and deterministic.

### Adding a new test (example)

The following minimal test was validated locally during this update (created temporarily and removed afterward, per the issue’s requirements). It demonstrates parsing and regenerating a minimal types.xml using the exported utilities:

```js
// tests/examples/demo.test.js
import { describe, it, expect } from 'vitest';
import { parseTypesXml, generateTypesXml } from '../../src/utils/xml.js';

describe('demo test: parse and regenerate minimal types.xml', () => {
  it('round-trips a minimal types entry', () => {
    const input = `
<types>
  <type name="DemoItem">
    <nominal>1</nominal>
    <min>0</min>
    <lifetime>60</lifetime>
    <restock>0</restock>
    <quantmin>-1</quantmin>
    <quantmax>-1</quantmax>
    <flags count_in_cargo="1" count_in_hoarder="0" count_in_map="1" count_in_player="0" crafted="0" deloot="0"/>
    <category name="tools"/>
    <usage name="Village"/>
  </type>
</types>`;
    const types = parseTypesXml(input);
    expect(types).toHaveLength(1);
    expect(types[0].name).toBe('DemoItem');
    const out = generateTypesXml(types);
    expect(out).toContain('<types>');
    expect(out).toContain('DemoItem');
  });
});
```

Run it with:
- npm test (watch), or
- npx vitest run

Note: The example above was executed successfully during this update, then removed to keep the repository unchanged except for this guidelines file.


## 3) Implementation Notes and Gotchas (project-specific)

The XML utility module at src/utils/xml.js encodes several important invariants that affect UI expectations and export determinism:

- parseLimitsXml(xml)
  - Accepts cfglimitsdefinition.xml and returns { categories, usageflags, valueflags, tags }.
  - Stable de-duplication of categories and usageflags (first occurrence order preserved).
  - valueflags and tags are de-duplicated then sorted, ensuring consistent tier/tag ordering.
  - Uses a resilient XML parser (safeParseXml): on parser error it retries without an XML declaration; finally throws a concise error if still invalid.

- parseTypesXml(xml)
  - Reads <type> entries with attributes and child elements into strongly-typed objects (see typedefs in the file).
  - Deduplicates usage/value/tag arrays per type.

- generateTypesXml(types)
  - Emits a deterministic, case-insensitive sorted order by type.name.
  - Outputs flags as numeric 0/1 attributes.
  - Emits category/usage/value/tag only when present; categories are optional, arrays emitted in provided order.

- generateLimitsXml(defs)
  - Produces a lists document with <category>, <usage>, <value>, <tag> children. valueflags and tags will reflect sorted ordering from parseLimitsXml if round-tripped.

- generateTypesXmlFromFilesWithComments(files)
  - Used to combine multiple source type files into a single output, inserting XML comments with the source file name.

- parseEconomyCoreXml(xml)
  - Extracts the group order and file paths from cfgeconomycore.xml. Only <file type="types"/> are included. Returned file paths are normalized for UI consumption.

Backend server specifics (server/index.js):
- Endpoints (all responses include permissive CORS; allowed headers include Content-Type and X-Editor-ID)
  - GET /api/health → basic health JSON { ok, dataDir, dataAvailable }
  - GET /api/definitions → DATA_DIR/cfglimitsdefinition.xml
  - PUT /api/definitions → replace cfglimitsdefinition.xml with request body (UI sets X-Editor-ID)
  - GET /api/economycore → returns DATA_DIR/cfgeconomycore.xml; if missing or empty, synthesizes from DATA_DIR/db and DATA_DIR/db/types
  - GET /api/types/:group/:file → reads declared types file. Special cases:
    - group=vanilla, file=types → DATA_DIR/db/types.xml
    - group=vanilla_overrides, file=types → if file is missing, returns an empty `<types/>` doc
  - PUT /api/types/:group/:file → writes declared file. Protections and behavior:
    - Denies writing to vanilla/types.xml
    - Requires group/file to be declared in cfgeconomycore.xml (except vanilla_overrides which is always allowed and auto-creates folder)
    - Accepts header X-Editor-ID; writes a per-group changes.txt with added/removed/modified entries and field-level diffs
  - POST /api/logs/stash-report → body: { start?: ISO, end?: ISO } → returns { players: [{ id, aliases[], dugIn, dugUpOwn, dugUpOthers }] }
  - POST /api/logs/adm → body: { start: string, end: string, x?: number, z?: number, y?: number, radius?: number, expandByIds?: boolean } → returns a text/plain ADM file for download. Notes:
    - Timestamps are interpreted as UTC+10 local times and normalized using moment
    - If x/z/radius provided, collects within planar radius; if expandByIds=true, expands to all lines by those ids in the range
    - ADM filename is derived from the requested UTC+10 range
  - GET /api/market/categories → lists category JSON file bases under profiles/ExpansionMod/Market
  - GET /api/market/category/:name → returns a market category JSON
  - PUT /api/market/category/:name → pretty-writes a market category JSON, creating directories as needed
  - GET /api/traderzones → lists trader zone JSON file bases under expansion/traderzones
  - GET /api/traderzones/:name → returns a trader zone JSON
  - PUT /api/traderzones/:name → pretty-writes a trader zone JSON, creating directories as needed
- Security/validation
  - Filenames and group names validated with conservative regex (letters, numbers, dash, underscore, dot). Requests failing validation get 400.
  - Writing to vanilla base types file is prohibited by design.
- Caching
  - The server caches group→folder and group→files derived from cfgeconomycore.xml. Restart the server to fully refresh caches after structural changes.
  - If cfgeconomycore.xml is empty or absent, the GET endpoint synthesizes a minimal document from the filesystem structure for UI consumption.

Frontend build nuance:
- vite.config.js sets base: './' so that a built app can be served from any sub-path (e.g., file:// or nested folders) without broken asset URLs.

ESLint nuance:
- 'no-unused-vars' is enabled; variables that are intentionally unused should be ALL_CAPS or prefixed appropriately to satisfy varsIgnorePattern: '^[A-Z_]'.

Frontend runtime/config nuance:
- API base override: Set localStorage key `dayz-editor:apiBase` to the server base URL (protocol+host+port, no trailing slash). Default is `${window.location.protocol}//${window.location.hostname}:4317` when not set.
- Editor ID gating: The UI requires selecting an Editor ID on each load; writes send it via `X-Editor-ID` and the server records it in per-group `changes.txt` along with added/removed/modified field-level diffs. IDs are stored in `dayz-editor:editorIDs` and selection in `dayz-editor:editorID:selected`.
- Persist flow: "Save to files" writes `cfglimitsdefinition.xml` and all declared group types except `vanilla/types.xml` (never written). On success, UI refreshes its baseline from the API so diffs reset.


## 4) Typical Dev Flows

- Local development (UI only)
  - npm ci
  - npm run dev
- Local development (UI + XML backend)
  - In a second terminal, run: node server/index.js (optionally set DATA_DIR to point at your DayZ economy files). The UI will communicate with the backend via the /api routes; CORS is open.
- Build and smoke test
  - npm run build && npm run preview
- Run tests
  - npm test (watch) or npx vitest run (single run)


## 5) When editing data files

- DATA_DIR structure must contain:
  - cfglimitsdefinition.xml
  - cfgeconomycore.xml (declares groups and their files)
  - db/types/<group>/<file>.xml for each types file declared in cfgeconomycore.xml
  - db/vanilla_overrides/types.xml is allowed for overrides; the server will auto-create the folder when writing
  - profiles/ExpansionMod/Market/*.json for Expansion Market categories (used by /api/market/*)
  - expansion/traderzones/*.json for Trader Zones (used by /api/traderzones/*)
  - logs/ for server Admin logs (used by stash report and ADM export)
- Keep in mind the determinism rules from utils when round-tripping: type entries are sorted by name on generation, and some flags arrays are sorted. If you depend on a particular order in diffs, align with these rules.


## 6) Troubleshooting

- Tests complain about missing DOMParser
  - Ensure you are running via Vitest (jsdom env). Running node directly on a test file won’t work.
- Frontend cannot reach the backend
  - Start the Node server (node server/index.js). If you run both locally, ports will differ; CORS is already allowed.
- Server cannot find a types file
  - Confirm group/file exists per cfgeconomycore.xml and resides in DATA_DIR/db/types/<group>/<file>.xml. Names must be alphanumeric/underscore/dash/dot per the server’s validation.
