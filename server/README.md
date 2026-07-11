# Lootmaster Persistence Server

A minimal, dependency-light Node.js HTTP server (`server/index.js`) that reads and writes a DayZ server's config files on disk for the Lootmaster frontend. It has no framework and no database — just the Node standard library plus `moment` (log timestamp parsing) and a small in-memory `ingest-store` for the optional companion-mod integration.

The server is **API-only** — it does **not** serve the built SPA or any static assets. In development the frontend is served by Vite; in production you host the built `dist/` separately and point it at this server.

## Running

```bash
# Production
node server/index.js

# Development (auto-injects an example test profile)
node server/index.js --dev
# or
NODE_ENV=development node server/index.js
```

- **Port:** `PORT` env var, default **4317**.
- **Dev mode** (`--dev` or `NODE_ENV=development`): if `../example dayz server directory` exists, a non-persisted test profile is prepended:
  `{ id: "example-dev-data", name: "Example Server (Dev Data)", missionName: "empty.deerisle" }`. It is stripped before `profiles.json` is ever written.

## Architecture

### Profiles

The server operates against one **profile** at a time, selected per request. Profiles live in `server/profiles.json`:

```json
{ "id": "<uuid>", "name": "My Server", "serverPath": "C:/…/serverfiles", "missionName": "dayzOffline.chernarusplus" }
```

`GET` responses additionally include a dynamically-detected `addons` array (not persisted). Add-on detection probes the server directory:

- `expansion` — `<serverPath>/profiles/ExpansionMod` **or** `<serverPath>/mpmissions/<missionName>/expansion`
- `deerisle` — `<serverPath>/profiles/Deerisle`

### Path resolution (`getPaths`)

All file access for a profile is derived from `serverPath` + `missionName`, where
`missionPath = <serverPath>/mpmissions/<missionName>` and `profilesPath = <serverPath>/profiles`:

| Config | Location |
|---|---|
| Definitions | `<missionPath>/cfglimitsdefinition.xml` |
| Economy core | `<missionPath>/cfgeconomycore.xml` |
| CLE types & spawnables | `<missionPath>/db/…` |
| Expansion Market | `<profilesPath>/ExpansionMod/Market/*.json` |
| Expansion Trader profiles | `<profilesPath>/ExpansionMod/Traders/*.json` |
| Expansion Trader maps | `<missionPath>/expansion/traders/*.map` |
| Expansion Trader zones | `<missionPath>/expansion/traderzones/*.json` |
| Expansion Airdrop settings | `<profilesPath>/ExpansionMod/Settings/AirdropSettings.json` |
| Expansion Mission settings | `<profilesPath>/ExpansionMod/Settings/MissionSettings.json` |
| Expansion Airdrop missions | `<missionPath>/expansion/missions/Airdrop_*.json` |
| ADM logs | `<serverPath>/log_storage` |
| Expansion logs | `<profilesPath>/ExpansionMod/Logs` |

### Request headers

- **`X-Profile-ID`** — selects the active profile. **Required for every `/api/*` route** except `/api/health` and the profile-independent routes listed below. A missing/unknown id returns `400 {"error":"Missing or invalid X-Profile-ID header"}`.
- **`X-Editor-ID`** — audit attribution, recorded in `changes.txt` and snapshot metadata (defaults to `unknown`).

Profile-independent routes (no `X-Profile-ID` needed): `/api/profiles*`, `/api/loadouts*`, `/api/scan-missions`, `/api/health`, and the companion-mod routes (`/api/catalog*`, `/ingest*`, `/items*`).

### CORS

Every response sends `Access-Control-Allow-Origin: *`, allows `GET,PUT,POST,OPTIONS,DELETE`, and permits the `Content-Type, X-Editor-ID, X-Profile-ID` headers. `OPTIONS` preflight returns `204`.

### Conventions

- **Request bodies:** raw XML string for XML routes; raw JSON string for JSON routes. JSON `PUT`s are validated (`JSON.parse`) before writing.
- **Indentation:** `profiles.json`, `loadouts.json`, and snapshot `metadata.json` use 2-space indent; all Expansion / mission / trader / market / addon JSON writes use 4-space indent (market, trader-profile, and trader-zone writes also append a trailing newline).
- **Backups:** `types`, `spawnabletypes`, and `randompresets` `PUT`s copy the previous file into a sibling `.lootmaster-backups/` folder with an ISO-timestamped `.bak` name before overwriting; the backup path is returned in the response.
- **Name safety:** group/file/category/trader/addon names are validated against `^[A-Za-z0-9._-]+$` and composed under fixed `getPaths` directories.

## API reference

Unless noted, XML routes return `Content-Type: application/xml` and JSON routes return `application/json`. Errors are JSON: `400` (bad request / bad profile), `404` (not found), `405` (method not allowed), `500` (internal error).

### Profiles & snapshots

| Route | Methods | Purpose |
|---|---|---|
| `/api/profiles` | GET, POST | List profiles (with detected `addons`); create a profile (requires `name`, `serverPath`, `missionName`) |
| `/api/profiles/:id` | GET, PUT, DELETE | Read / update (merge, id preserved) / delete a profile |
| `/api/profiles/:id/missions` | GET | List mission subfolders under the server's `mpmissions/` |
| `/api/profiles/:id/snapshots` | GET, POST | List snapshots (newest first); create a snapshot of the mission's CLE + Expansion config |
| `/api/profiles/:id/snapshots/:snapshotId` | DELETE | Delete a snapshot |
| `/api/profiles/:id/snapshots/:snapshotId/restore` | POST | Auto-backup current state, then restore the snapshot |
| `/api/scan-missions` | POST | Given a raw `serverPath`, list its mission subfolders (used before a profile exists) |

Snapshots are stored in `<missionPath>/.lootmaster/snapshots/` and capture `cfgeconomycore.xml`, `cfglimitsdefinition.xml`, `cfgspawnabletypes.xml`, `cfgrandompresets.xml`, the whole `db/` and `expansion/` trees, and `ExpansionMod/Market` + `ExpansionMod/Traders`.

### CLE core & mission configs

| Route | Methods | Purpose |
|---|---|---|
| `/api/definitions` | GET, PUT | `cfglimitsdefinition.xml` |
| `/api/economycore` | GET | `cfgeconomycore.xml` (synthesized by scanning `db/` if missing/empty) |
| `/api/types/:group/:file` | GET, PUT | A group's `types.xml`. See **Vanilla protection** and **Audit trail** below |
| `/api/spawnabletypes/:group/:file?` | GET, PUT | A group's spawnabletypes file (auto-registers new non-vanilla files in `cfgeconomycore.xml`) |
| `/api/mission/randompresets` | GET, PUT | `cfgrandompresets.xml` |
| `/api/mission/globals` | GET | `db/globals.xml` |
| `/api/deerisle/diving-loot` | GET, POST, PUT | Deerisle `DivingLootConfig.json` |

**Vanilla protection:** `PUT /api/types/vanilla/types` is rejected (`400`). Edits to vanilla items are saved to the `vanilla_overrides` group (`db/vanilla_overrides/types.xml`); the base `db/types.xml` is read-only.

**Audit trail:** `PUT /api/types/:group/:file` appends a human-readable diff to `<groupDir>/changes.txt`, attributed to `X-Editor-ID`. Each entry records added/removed types and per-field changes (e.g. `Nominal: 10 -> 20`) across nominal/min/lifetime/restock/quant/flags/usage/value/tag.

### Expansion — airdrops

| Route | Methods | Purpose |
|---|---|---|
| `/api/expansion/airdrop-settings` | GET, PUT | `AirdropSettings.json` — global airdrop config + per-container loot |
| `/api/expansion/mission-settings` | GET, PUT | `MissionSettings.json` — the airdrop scheduler (airdrops are the only Expansion mission type) |
| `/api/expansion/airdrop-missions` | GET, PUT, DELETE | Per-drop `Airdrop_*.json` files; `GET` lists `[{file, data}]`, `PUT`/`DELETE` take `?file=Airdrop_*.json` |

### Expansion — market & traders

| Route | Methods | Purpose |
|---|---|---|
| `/api/market/categories` | GET | List market category names |
| `/api/market/category/:name` | GET, PUT | Read/write one market category JSON |
| `/api/market/remove-item-completely` | POST | Purge a `className` from every market file, trader zone, and trader profile (body `{className}`); returns removal counts |
| `/api/traders` | GET | List trader `.map` names |
| `/api/traders/:name` | GET, PUT | Read/write a trader `.map` (parsed to/from structured JSON) |
| `/api/trader-profiles` | GET | List trader-profile names |
| `/api/trader-profile/:name` | GET, PUT | Read/write a trader-profile JSON |
| `/api/traderzones` | GET | List trader-zone names |
| `/api/traderzones/:name` | GET, PUT | Read/write a trader-zone JSON |

### Logs (all `POST`)

Log timestamps are interpreted as **UTC+10**. Bodies take a `{start, end}` ISO range plus route-specific options.

| Route | Purpose | Body extras |
|---|---|---|
| `/api/logs/adm` | Concatenate ADM records in range → downloadable `.ADM` | optional `x,z,radius` spatial filter, `expandByIds` |
| `/api/logs/expansion` | Same, for Expansion `ExpLog_*.log` → downloadable `.log` | same as ADM |
| `/api/logs/stash-report` | Aggregate dug-in/dug-up stash events per player | — |
| `/api/logs/heatmap-data` | Extract coordinates for a heatmap | `dataType`: `all` \| `connect` \| `disconnect` \| `kill` |

### Loadouts (profile-independent, `server/loadouts.json`)

| Route | Methods | Purpose |
|---|---|---|
| `/api/loadouts` | GET | List shared modular loadout templates |
| `/api/loadouts/:id` | PUT, DELETE | Upsert / delete a loadout by id |

### Utility

| Route | Methods | Purpose |
|---|---|---|
| `/api/lint` | GET | Lint every `.xml`/`.json` under the mission and profiles dirs |
| `/api/health` and `/` | GET | Health check: `{ok: true, profilesCount}` |

### Companion-mod integration (optional)

These profile-independent routes back an in-game companion mod that pushes live state and answers world scans, via the in-memory `server/ingest-store.js`. Catalog state is persisted across restarts.

| Route | Methods | Purpose |
|---|---|---|
| `/api/catalog/health` | GET | `{ok, modConnected}` |
| `/api/catalog/types` | GET | Bulk type list `[{name, displayName}]` |
| `/api/catalog/types/:name` | GET | Normalized type detail + attachment graph |
| `/ingest/snapshot` | POST | Mod pushes full live state |
| `/ingest/catalog` | POST | Mod pushes config-derived type metadata |
| `/ingest/commands` | GET | Mod polls pending commands |
| `/ingest/commands/ack` | POST | Mod acks a command result |
| `/items` | GET | Live world-item scan around `?x&z&radius` (default 30, cap 200) |
| `/items/near/:playerId` | GET | Same scan centred on a player's last-known position |

`/items*` block until the mod responds (default 10s, `ITEM_SCAN_TIMEOUT_MS`) → `504` on timeout, `503` if the mod is disconnected.

## Notes & caveats

- **`/api/addons/*`** (`GET .../files`, `GET|PUT .../file/:name`) is a generic per-addon JSON accessor: it lists/reads/writes top-level `.json` files in the addon's `profiles/<folder>` directory (resolved from the addon's `profile`-type probe). The endpoint is functional, but its only frontend consumer (`AddonEditorModal`) is currently not wired up — it is mounted with mismatched props and has no navigation entry, so the feature is unreachable from the UI. Deerisle diving loot uses the dedicated `/api/deerisle/diving-loot` route.
- The whole request handler is wrapped in a try/catch that returns `500 {"error":"Internal Server Error"}` on any unhandled failure.
