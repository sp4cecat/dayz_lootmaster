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
never renders as a reading), and `alive` — an Enforce `bool` — arrives as `1`/`0`
because that is how Enforce's JsonSerializer emits bools (the same quirk
`buildCatalogDetail` handles for the catalog's boolean flags), which is why
`openapi-ingest.json` declares it `integer, enum [0,1]`. `true`/`false` are
accepted too, in case that ever changes.

## Quest-item containment — handled upstream, not here

**Lootmaster does no containment inference.** `spacecat_gamelabs`
(`F:/Dayz Dev/sauce/azmod/workspace/spacecat_gamelabs`) replaces `@CW_Gamelabs`
and decides placement in Enforce: an item on a player or inside another
container's cargo gets **no GameLabs marker at all**, and a marker is added or
dropped *as the item moves* (`EEItemLocationChanged`) rather than being decided
once at spawn. So anything that reaches the events layer is world-placed.

This retired `computeStoredEventIds` in `src/components/live/LiveMarkers.tsx` — a
proximity heuristic that greyed an item sitting within 1.5 m of a container,
vehicle, or player. It existed only because CW_Gamelabs published markers for
carried items and the payload carried no containment field. Under the new mod it
could only ever fire on genuinely loose ground loot, i.e. as a false positive.

What remains is the spawn ledger's `moved` flag, which is unaffected and now
strictly more meaningful: it marks a world item that is no longer where it
spawned. `EventMarker`'s `stored` prop is driven solely by it.

**Caveat:** this holds only for servers running `spacecat_gamelabs`. A profile
still on `@CW_Gamelabs` will show markers for carried items with nothing to grey
them — the two mods must never run together on the same server.

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

## Territory metadata enrichment — shipped

**Solved by `spacecat_gamelabs`; approach 1 below is what it does.** The original
blocker still stands as stated — verified against the Expansion source
(`ExpansionTerritoryModule.c`, `TerritoryFlag.c`): owner/members/level persist via
`CF_OnStoreSave`/`CF_OnStoreLoad` (CF_ModStorage) inside the entity storage `.bin`
files, **not** as parseable JSON under `profiles/ExpansionMod/`. There is no
zero-mod-change path. What changed is that the mod now exists.

`SGL_TerritoryFlag.c` (in the separate `spacecat_gamelabs_compat_expansion` PBO,
which must be separate because `requiredAddons` — not `-mod=` position — decides
script-module order) takes over GameLabs' own flag marker and rebuilds the tooltip
as a strict superset of theirs:

```
<b>Northwood</b><br/>Flag Level: 87 %<br/>Remaining Lifetime: ~ 41 hours<br/>
Owner: PlayerOne (76561198000000000)<br/>
Territory: #4 &middot; Level 2 &middot; 3 member(s)<br/>
<b>Members</b>:<br/>&nbsp;&nbsp;PlayerTwo (76561198000000001) - Moderator
```

The takeover works by never calling `_SetEventInstance()`, which leaves GameLabs'
handle pointing at its own unregistered event and makes its hourly maintenance tick
a permanent no-op. One benign `RegisterEvent - failed (_reference already added)`
per flag per hour in GameLabs' debug log is expected, not a bug.

### Parsing it back (`server/cftools-service.js`)

That whole string arrives verbatim as the event's `display_name`, so
`parseTerritoryTooltip()` turns it into `LiveEvent.territory`
(`name`, `flagLevel`, `lifetimeHours`, `owner`, `territoryId`, `level`,
`memberCount`, `members[]`, `membersOmitted`) and replaces `displayName` with the
plain territory name — otherwise every consumer of `displayName` (marker title,
panel heading, GameLabs action label) renders raw markup.

Four things the parser has to get right, each with a regression test:

- **Entity decoding.** The mod escapes player-supplied text (`SGL_Text.EscapeHtml`)
  because the panel renders HTML, so `&amp;` must be decoded *last* — decoding it
  first would turn a literal `&amp;lt;` into `<`.
- **Config-dependent shapes.** `territory_show_uids: false` yields bare names;
  an unknown name yields a bare UID; `territory_show_members: false` drops the
  roster entirely. Every field is therefore optional.
- **Roster position, not indentation.** The `&nbsp;&nbsp;` indent is cosmetic and
  collapses with the rest of the whitespace; member lines are identified by
  following the `Members:` header instead.
- **Rank split, not name split.** A member called `Bob - the - Builder` must split
  on the trailing rank, so the pattern anchors on `Admin|Moderator|Member` at the
  end rather than on the first ` - `.

Parsing is best-effort by design: unrecognised lines are skipped, and a tooltip
with no labelled line at all returns null, leaving the event untouched. A flag
still showing GameLabs' baseline marker — or a future wording change in the mod —
degrades to the previous behaviour rather than blanking the panel.

`memberCount` is Expansion's own `NumberOfMembers()`: it includes the owner and
ignores the `territory_max_members` display cap, so it can exceed `members.length`.
`membersOmitted` carries the difference the mod reported as `... and N more`.

The `territories[]`-on-`/ingest/snapshot` alternative previously recommended here
is no longer needed and was not built.

## Non-goals

- Replacing the `/ingest` command channel — it stays primary (locality, no
  subscription dependency, result round-trips built in).
- Nested-loadout spawning over GameLabs — `CFCloud_SpawnPlayerItem` cannot
  preserve attachment/cargo nesting; full-fidelity spawn would be a new
  spacecat capability (`Spacecat_SpawnLoadout` taking a JSON tree), which fits
  the extension model above if ever needed.
