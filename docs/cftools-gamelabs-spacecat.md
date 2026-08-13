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
