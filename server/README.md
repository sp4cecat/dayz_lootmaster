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
- **Log timezone:** `LOG_TIMEZONE` env var (an IANA name such as `Australia/Sydney`),
  used for profiles that have no `logTimeZone` of their own. Defaults to the host's zone.
- **Dev mode** (`--dev` or `NODE_ENV=development`): if `../example dayz server directory` exists, a non-persisted test profile is prepended:
  `{ id: "example-dev-data", name: "Example Server (Dev Data)", missionName: "empty.deerisle" }`. It is stripped before `profiles.json` is ever written.

## Architecture

### Profiles

The server operates against one **profile** at a time, selected per request. Profiles live in `server/profiles.json`:

```json
{ "id": "<uuid>", "name": "My Server", "serverPath": "C:/…/serverfiles", "missionName": "dayzOffline.chernarusplus", "logTimeZone": "Australia/Sydney" }
```

`logTimeZone` is the IANA zone the **game server's** clock runs in. DayZ logs record a
bare wall clock with no zone, so this is the only thing that turns a log line into a
moment; it is used by ADM Records, the Expansion log reader, the stash report and the
ADM history import. It must be a zone name rather than an offset because half the world
observes daylight saving — Australia/Sydney is +11:00 (AEDT) from October to April and
+10:00 (AEST) otherwise, and a fixed offset is silently an hour out for half of every
archive. Falls back to `LOG_TIMEZONE`, then to the zone this host is in. All conversion
lives in `server/log-clock.js`.

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
| `/api/expansion/airdrop-locations` | GET, PUT | Lootmaster-owned drop-zone library under `.lootmaster/` (not read by the game); missions reference these by Name |
| `/api/expansion/airdrop-loot-lists` | GET, PUT | Lootmaster-owned reusable loot-list library under `.lootmaster/` (not read by the game); `{lists, links}` — a list's loot is flattened into linked containers/missions on save |

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
| `/ingest/events` | POST | Mod pushes a batch of action events (pickup/drop/death/…) |
| `/ingest/inventory` | POST | Mod pushes one player's full inventory tree |
| `/ingest/commands` | GET | Mod polls pending commands |
| `/ingest/commands/ack` | POST | Mod acks a command result |
| `/items` | GET | Live world-item scan around `?x&z&radius` (default 30, cap 200) |
| `/items/near/:playerId` | GET | Same scan centred on a player's last-known position |

`/items*` block until the mod responds (default 10s, `ITEM_SCAN_TIMEOUT_MS`) → `504` on timeout, `503` if the mod is disconnected.

The full wire contract lives in the mod's own `openapi-ingest.json` (currently 1.2.0).
Two conventions from it are worth restating here because they shape the storage:

- **Events and inventories carry an `age`, not a timestamp.** The mod has no wall
  clock — `GetGame().GetTime()` counts from mission start — so the backend anchors
  every row to its own receive time. The age is capped (1 h) so a garbage value
  cannot back-date a row into the middle of an imported archive.
- **`(session, n)` is a dedup key.** The mod re-queues a batch it never saw
  acknowledged, so both writes are `INSERT OR IGNORE` against it. Without that, a
  dropped reply would invent a second pickup that never happened.

`/ingest/events` and `/ingest/inventory` are the only routes with a request-body
cap (1 MB and 2 MB). A `413` on either is safe in a way it would not be on
`/ingest/snapshot`: only snapshot success un-latches catalog delivery, and the
dedup key makes the mod's retry free.

### Recorded history (profile-independent)

`server/history-store.js` tees `/ingest/*` into a `node:sqlite` database at
`server/.cache/history.db`. Read routes follow the house rule and never 5xx — they
answer `200 { available: false, reason }` so the tool can render its own empty state
for a feature that is merely switched off.

| Route | Methods | Purpose |
|---|---|---|
| `/api/history/stats` | GET | Volume, span, recorder health. Answers even when recording is off |
| `/api/history/online` | GET | Who the mod says is connected right now (no CF Tools needed) |
| `/api/history/players` | GET | Players with samples in `?from&to` |
| `/api/history/track` | GET | Decimated paths for `?ids=a,b`, `?max=` points each |
| `/api/history/at` | GET | One row per player nearest `?ts`, within `?tol` |
| `/api/history/area` | GET | Presence intervals inside `?x&z&radius` |
| `/api/history/actions` | GET | Action feed; filter by `?ids`, `?kinds`, or a circle |
| `/api/history/inventory` | GET | A player's snapshots, WITHOUT their trees |
| `/api/history/inventory/:id` | GET | One snapshot with its full tree, names resolved |
| `/api/history/capture` | POST | Ask the mod to snapshot a player's inventory now |
| `/api/history/rollback` | POST | Apply a stored loadout back onto a live player |

The two POSTs are action routes, not read routes: they change the game world, so
they return real status codes (`503` mod offline, `409` player offline / snapshot
truncated, `504` no ack in time). `/api/history/capture` returns `202` — the
snapshot itself arrives over `/ingest/inventory` on the mod's next flush, so the
caller re-reads the list rather than being handed a tree that does not exist yet.

**A rollback duplicates items**, and there is no way around it: the economy keeps no
record of where an item came from, so restoring a rifle the player has since traded
puts a second one into circulation. It is stated in the confirmation dialog, refused
outright for a snapshot whose capture was truncated (unless overridden), and written
back into the action log as `kind: 'rollback'`. Vitals are opt-in and omitted by
default — the commonest snapshot to restore is a death, whose recorded health is 0.

Environment:

| Variable | Default | Effect |
|---|---|---|
| `HISTORY_ENABLED` | on | `0` disables recording entirely |
| `HISTORY_DB_FILE` | `server/.cache/history.db` | Database location |
| `HISTORY_FULL_DAYS` | `7` | Positions kept at full 5 s fidelity |
| `HISTORY_THIN_DAYS` | `90` | Beyond this, positions/actions/inventories are deleted |
| `HISTORY_RECORD_AI` | off | `1` also records AI positions (40+ entities at 5 s) |
| `ROLLBACK_TIMEOUT_MS` | `20000` | How long a rollback waits for the mod's ack |

Positions are thinned to one sample per player per minute past `HISTORY_FULL_DAYS`;
actions and inventories are never thinned, only deleted, because "he picked it up at
04:12" has no coarser version that is still true. Rows imported from admin logs are
exempt from retention entirely — an archive is almost always older than the drop
cutoff, and unlike mod rows it cannot be re-recorded.

Requires Node 22.5+ for `node:sqlite`. On an older Node, recording reports itself as
unavailable through `/api/history/stats` and nothing else changes.

**Trust boundary.** `/ingest/*` is unauthenticated and profile-independent, as it has
always been — this adds durable storage and an inventory-rewriting command behind
it. Bind the backend where only the game server can reach it. The `srv` column on
every table is the hedge against two game servers pointing at one Lootmaster.

## Notes & caveats

- **`/api/addons/*`** (`GET .../files`, `GET|PUT .../file/:name`) is a generic per-addon JSON accessor: it lists/reads/writes top-level `.json` files in the addon's `profiles/<folder>` directory (resolved from the addon's `profile`-type probe). The endpoint is functional, but its only frontend consumer (`AddonEditorModal`) is currently not wired up — it is mounted with mismatched props and has no navigation entry, so the feature is unreachable from the UI. Deerisle diving loot uses the dedicated `/api/deerisle/diving-loot` route.
- The whole request handler is wrapped in a try/catch that returns `500 {"error":"Internal Server Error"}` on any unhandled failure.
