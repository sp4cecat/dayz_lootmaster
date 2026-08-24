# Spec: exposing spacecat capabilities through GameLabs (analysis only)

Status: **specification — no mod code in this repo.** The existing `/ingest`
command channel (openapi-ingest.json) stays the primary transport; this
documents how `spacecat_dayz_server_api` could additionally register its
capabilities as GameLabs dynamic actions so they become available in the
CFTools Cloud UI **and** over the CF Tools Data API that Lootmaster now proxies
(`server/cftools-client.js` → `POST /v1/server/{api_id}/GameLabs/action`).

## Why bother

- The spacecat mod's RestApi is outbound-only and bound to the same host as the
  Lootmaster backend. Registering actions with GameLabs gives the same
  capabilities a second, remotely reachable transport with CF Tools handling
  auth, rate limiting and the admin UI.
- Custom actions appear automatically in Lootmaster's Live Map "GameLabs
  actions" panel (`src/components/live/RawActionPanel.tsx` generates a form
  from each action's typed parameters) — zero frontend work per new action.

## Per-player telemetry (health / item in hands) — settled

**GameLabs cannot supply this to Lootmaster.** Verified against the mod itself
(v1.938, workshop 2464526692). Its `.c` files are obfuscated stubs, but JAPM
dumped the real source to `@GameLabs/Addons/000_Scripts/__JAPM__/unknown*.txt`.

GameLabs already *collects* exactly what we want — `_ServerPlayerEx` (in
`5_Mission/definitions.c`) sets `health = GetHealth("GlobalHealth","Health")` and
`item = GetItemInHands().GetType()`, and the reporter POSTs the list to
`/v1/server/players` on `api.gamelabs.cloud` every ~10 s. That is why the CF Tools
Cloud UI map shows both. It is one-way: the public Data API has no route that
reads it back (`/GameLabs/entities/players` probed 2026-08 → 404), GSM sessions
omit both, and `_ServerPlayer` is a fixed struct with **no extension point** —
there is no `SetPlayerMeta`, no custom player fields, no per-player event.

The only writable per-player field anywhere in the API is `PlayerBase.gl_name`
(a GameLabs-injected string; `ZenNameMapLink` uses it to append a character name
to the marker label). It is the player's *name* — overloading it corrupts the
roster, kick/ban and chat views — and it still only reaches `/v1/server/players`.

Fallbacks, if a *remote* server ever needs this without an `/ingest` path:

1. Register an `_Event` bound to the `PlayerBase` with health/hands in the HTML
   `displayName` (Basic Territories proves `<b>`/`<br/>` render). This *is*
   readable — it surfaces on `/GameLabs/entities/events`, which Lootmaster already
   polls. Costs: a shadow marker per player in the Cloud UI, 10 s granularity,
   no update channel (`RemoveEvent` + re-register), and a position join back to
   the real player.
2. A `player`-context `GameLabsContextAction` with a `webhook_url` response —
   one round-trip per invocation, wrong shape for a stream.
3. `GetApi().KV_SET(...)` — writes to `api.gamelabs.cloud`, which Lootmaster
   cannot read.

**What shipped instead:** the spacecat mod's `SpacecatPlayerInfo` gained a
`hands` field (`GetItemInHands().GetType()`); `health` was already on the wire.
`buildLiveSnapshot` in `server/cftools-service.js` now merges the mod snapshot
onto the CF Tools player roster via `enrichFromMod()`, joined on steam64
(`PlayerIdentity.GetPlainId()` == `gamedata.steam64`), gated on
`ingest.modConnected()`. CF Tools remains the roster; the mod only enriches.

`blood`, `shock`, `energy`, `water` and `alive` ride the same merge and render as
conditional rows in the side panel (`heatComfort` is on the wire too but is not
surfaced). Two wire quirks the merge normalises: the mod's `StatValue()` returns
**-1** for a stat the engine doesn't declare (collapsed to null, so "unknown"
never renders as a reading), and `alive` crosses as a bool from Enforce's
JsonSerializer despite `openapi-ingest.json` declaring it `0|1` — both are
accepted.

## How GameLabs extensions work

Reference: `CFToolsGameLabs/game-plugin-dayz` + `CFToolsGameLabs/dayz-examples`
(`dynamic_actions/`, `custom_map_icons/`).

1. Depend on the GameLabs mod (workshop id 2464526692) and implement a
   `GameLabsContextAction` subclass per action.
2. Register each action in `MissionServer` via `Register()`. GameLabs uploads
   the registry to CFTools Cloud; the action then shows in the Cloud UI and in
   `GET /v1/server/{api_id}/GameLabs/actions`.
3. When triggered remotely, GameLabs invokes `Execute(GameLabsActionContext context)`
   server-side with the resolved entity reference (player/vehicle/object) and
   typed parameters. Error handling is the action's own responsibility.

Action definition fields (from the dayz-examples README):

| Field | Notes |
|---|---|
| `actionCode` | `{Prefix}_{Action}`, must equal the class name — e.g. `Spacecat_ScanItems` |
| `actionName` | Human-readable ASCII |
| `actionIcon` | FontAwesome v5 name (rendered dualtone in the Cloud UI) |
| `actionColour` | `success` / `danger` / `warning` / `default` |
| `actionContext` | `world` / `player` / `vehicle` / `object` |
| `parameters` | Typed: `int`, `float`, `string`, `boolean`, `vector`, `cf_itemlist`, `webhook_url` |

## Proposed action: `Spacecat_ScanItems`

Mirrors the `/ingest` `scanItems` command (world-context, region-scoped).

- `actionCode`: `Spacecat_ScanItems`, `actionContext`: `world`
- Parameters:
  - `center` (`vector`) — scan centre; the y component is ignored
  - `radius` (`int`) — clamped server-side to 200 m, same as the mod's command handler
  - `callback` (`webhook_url`) — GameLabs POSTs the completion webhook from the
    game server; the mod attaches the `ItemInfo[]` result as the payload
- `Execute()` reuses the existing scan implementation behind the `/ingest`
  command handler; only the transport differs.
- Result delivery: unlike the `/ingest` ack round-trip, GameLabs actions are
  fire-and-forget from the caller's view — the `webhook_url` parameter is the
  only result channel. Lootmaster would set it to a new
  `POST /ingest/gamelabs-callback` route (same trust model as `/ingest/*`).

Other 1:1 candidates: `Spacecat_Broadcast` (`string message`),
`Spacecat_RefreshCatalog` (no params — re-trigger the chunked catalog push).

## Territory metadata enrichment (the P2 fallback)

Verified against the Expansion source (`ExpansionTerritoryModule.c`,
`TerritoryFlag.c`, experimental branch): territory owner/members/level persist
via `CF_OnStoreSave`/`CF_OnStoreLoad` (CF_ModStorage) inside the entity storage
`.bin` files — **not** as parseable JSON under `profiles/ExpansionMod/`. So the
zero-mod-change enrichment path is not viable and the Live Map ships flags-only
territory markers (position + TerritorySize radius).

To enrich, a small server-side extension (in spacecat or standalone) would:

1. Override GameLabs' base tracking of `TerritoryFlag` with a custom `_Event`
   registration (see `dayz-examples/custom_map_icons/territory_flag.c` — note
   the **deferred loading** requirement when overriding base-tracked objects).
2. Attach metadata to the event label/params: owner name, member count, level
   (`ExpansionTerritoryFlagBase.GetTerritory()` exposes all of it server-side).
3. Lootmaster's `server/cftools-service.js` `normalizeEvent()` already passes
   `displayName` through; extend it to parse the structured label if adopted.

Alternative without touching GameLabs: the spacecat mod adds a `territories[]`
array to its 5-second `/ingest/snapshot` push (owner/members/level/position),
and Lootmaster's `buildLiveSnapshot` merges it into the `territories` layer by
position proximity (~5 m). This keeps all enrichment on the existing transport
and is the recommended path since we control both ends.

## Non-goals

- Replacing the `/ingest` command channel — it stays primary (locality, no
  subscription dependency, result round-trips built in).
- Nested-loadout spawning over GameLabs — `CFCloud_SpawnPlayerItem` cannot
  preserve attachment/cargo nesting; full-fidelity spawn would be a new
  spacecat capability (`Spacecat_SpawnLoadout` taking a JSON tree), which fits
  the extension model above if ever needed.
