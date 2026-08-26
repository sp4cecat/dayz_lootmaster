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
was judged unnecessary once the tooltip path shipped — **and that judgement turned
out to be wrong.** It has since been built; see *Territories over `/ingest`* below
for what changed and why. The tooltip path is not retired: it remains the only
source when the companion mod is stale.

### Diagnosing a flag that clicks but shows nothing

The tooltip is the *only* channel this data arrives on, so anything that loses the
label loses the whole territory panel — and every way of losing it looks identical
from the map: a flag marker that selects fine and has no detail under it.

GameLabs uploads the marker as `_ServerEvent`
(`Scripts/3_Game/API/definitions.c` in `CFToolsGameLabs/game-plugin-dayz`):

```c
class _ServerEvent {
    string id; string icon; string className; string displayName; vector position;
};
```

That is camelCase, while the Data API is snake_case elsewhere (`gamesession_id`,
`cftools_id`), and CF Tools documents neither shape for
`/v1/server/{api_id}/GameLabs/entities/events`. `normalizeEvent` therefore accepts
`display_name` / `displayName` first and `name` / `label` / `title` after (no
`_ServerEvent` field has those names, so one appearing can only be this one
renamed), and `normPosition` accepts `[x,y,z]`, `{x,y,z}` and a `vector` rendered
as a string (`"<7500, 300, 2500>"` or `"7500 300 2500"`).

When it still comes up empty, `GET /api/cftools/raw/events` (`?limit=`, default 25,
`X-Profile-ID` scoped) returns the untouched upstream payload plus `envelopeKeys`,
`keys` and `count`. Those three separate the failures that are otherwise identical:

| Symptom in the raw payload | Cause |
|---|---|
| `count: 0` with `envelopeKeys` naming an array we don't read | the envelope was renamed — `entityList` finds nothing, so **no** markers render |
| entities present, no label key in `keys` | the label field was renamed — markers render, every tooltip is lost |
| label present, plain `Territory Flag` baseline text | `spacecat_gamelabs_compat_expansion` is not enriching (absent, mis-ordered, or the flag has no territory) |

The side panel reports the last two distinctly rather than rendering blank —
`TerritoryUnavailable` in `LiveSidePanel.tsx` splits on whether a label arrived at
all. `enrichTerritory` also flattens an unparsed markup label to its first plain
line, so GameLabs' own baseline tooltip can't render `<b>`/`<br/>` as panel-title
text.

## Territories over `/ingest` — shipped

### Why the tooltip path was not enough

**The live Outland server runs `BasicTerritories`, not Expansion territories.**
`@OutlandServers/addons/` ships `BasicTerritories` + `BasicTerritoriesDefines`, and
`spacecat_gamelabs_compat_expansion` correctly stands down on a flag with no Expansion
territory registered (`HasExpansionTerritoryInformation()` is false). So BasicTerritories'
own GameLabs marker wins, and everything it publishes is:

```
<b>Basic Territory</b><br/>Owner: [ <BI GUID> ]<br/>Raised: 87%
```

No members, no counts, and the owner is a **BI GUID** (`GetIdentity().GetId()`), not a
steam64. The panel was not broken — there was simply nothing on the wire to show. Both
territory systems are live on that server, so the fix has to serve both.

Two further facts settled the design:

- **Both systems key members by BI GUID**, verified in BasicTerritories'
  `ActionAcceptMembership.c` and Expansion's `ExpansionTerritoryModule.c`. Lootmaster
  joins on steam64, so unresolved GUIDs would render as opaque base64.
- **ZenTerritories is not in the Outland pack**, and its "Objects | Cargo" feature is
  pure vanilla underneath — `GetObjectsAtPosition3D` + `IsRefresherSignalingViable()` +
  `GetCargo().GetItemCount()`. So the mod computes the counts itself and takes no new
  dependency.

### Four PBOs, because `requiredAddons` is a conjunction

```
spacecat_dayz_server_api                     {"DZ_Data"}
spacecat_dayz_server_api_compat_bt           + {"spacecat_dayz_server_api","BasicTerritories"}
spacecat_dayz_server_api_compat_expansion    + {"spacecat_dayz_server_api","DayZExpansion_BaseBuilding_Scripts"}
spacecat_dayz_server_api_compat_expansionai  + {"spacecat_dayz_server_api","DayZExpansion_AI_Scripts"}
```

One combined compat PBO would refuse to load on a server running only one territory
system — i.e. on every real server. **One compat PBO per third-party addon whose symbols
you take.** The core keeps `{"DZ_Data"}` so it loads everywhere, which is exactly what
sorts it into an early script-module tier and forbids it from naming an Expansion or
BasicTerritories symbol. Getting that wrong does not degrade the feature; it fails to
compile the World module and the server does not start. This is the same rule, and the
same failure, documented at length in `spacecat_gamelabs_compat_expansion/config.cpp`.

Territory data reaches the core through a virtual hook on a core-owned
`modded class TerritoryFlag` (`Spacecat_CollectTerritory`), which each compat overrides.
It has to be a modded class rather than a provider object because BasicTerritories keeps
its roster in a `protected` member, and only a subclass — which a later modded layer is —
can read it. AI classification goes through a registry instead, so nothing has to reason
about layering `modded PlayerBase` after `eAIBase extends PlayerBase` is declared.

Each compat prints a registration line at `OnInit`. That line is the only proof its
script module actually compiled — `ConfigIsExisting("CfgPatches …")` proves the config
parsed and nothing more, and "no compat registered" is otherwise indistinguishable from
"no flag has a territory".

### Two sources, one layer

`buildTerritoryLayer()` in `server/cftools-service.js` now merges the GameLabs tooltip
with `territories[]` from the mod snapshot.

**The mod wins per-field; the tooltip fills gaps.** The tooltip is a lossy, config-gated,
string-formatted projection — `territory_show_uids` strips steam64s,
`territory_show_members` drops the roster, `territory_max_members` truncates it, and it
exists at all only if the GameLabs compat is installed and correctly ordered. The mod
reads the territory module in-process on the game server. Where the mod's value is a
sentinel (`-1`/`""` → null) the tooltip's real value survives, which is how a
BasicTerritories flag still shows a level from an Expansion tooltip.

**The join is positional.** The GameLabs `_ServerEvent.id` and the mod's flag key are
unrelated private handles from different mods, so there is nothing to join on but
position. Flags do not move. `TERRITORY_JOIN_EPS_M = 5` — larger than the spawn ledger's
2 m because this compares two *independent* observers of one object rather than one
observer against itself — and pairs are consumed greedily nearest-first so two adjacent
flags cannot both claim one mod row.

**Unmatched mod rows become markers**, which deliberately breaks the "never create rows"
rule `enrichFromMod` follows. That rule exists because the players layer has an
authoritative roster (CF Tools sessions) and a phantom player is a false claim with
destructive admin actions hanging off its steam64. Territories have no authoritative
roster, the GameLabs feed is itself best-effort, and a territory marker exposes no
destructive per-entity action. The asymmetry is intentional.

Three states worth knowing:

| Situation | Result |
|---|---|
| Mod stale (`modConnected()` false) | The mod contributes nothing anywhere. The layer is byte-for-byte what it was before this work — a mod restart can never blank tooltip-sourced detail. |
| GameLabs upstream failed | The layer renders from the mod alone, reporting `source: 'mod'`. It must **not** carry `error`, which the UI reads as "empty, show unavailable". |
| Neither | `{ error: <reason>, items: [] }`, as before. |

### The GUID ledger

`$profile:spacecat/guid_ledger.json` maps GUID → steam64 + last known name, so an
**offline** territory member still resolves to something readable — which is the normal
case, since a roster is mostly people who are not logged in. Written once per join
(`Touch` from `InvokeOnConnect`); the snapshot loop calls `Observe`, which fills gaps and
picks up renames but never rewrites `lastSeen`, so a steady server dirties nothing on a
tick. Flush is debounced (60 s) because it is synchronous file I/O on the sim thread.

A GUID a territory currently references is never evicted by the entry cap. Without that
guard, a long-offline owner's name is pruned and the feature silently fails for exactly
the player it exists to name.

### Object and cargo counts

Counted by the mod with the vanilla spatial query, cached on the flag, and refreshed by a
single round-robin scanner with a per-tick budget — `territoryScanBudget /
territoryScanTick` queries per second, **flat, regardless of flag count**. A snapshot
never triggers a spatial query. The failure mode is a stale count, which `scanAge`
reports; it is never a stall. `territoryScanObjects: false` removes every query, and the
counts then stay `-1`, which the panel renders as unknown rather than as a fake zero.

## AI characters — shipped

`GetGame().GetPlayers()` returns Expansion AI, because `eAIBase extends PlayerBase`. The
mod's collector had no filter, so **AI were already leaking into `snapshot.players[]`** as
nameless rows and inflating `server.online`; they were invisible in Lootmaster only
because `enrichFromMod` left-joins onto CF Tools sessions and dropped them. The collector
now splits on identity and reports AI in their own `ai[]` array.

⚠️ **`server.online` will drop when this deploys**, as AI and logged-out bodies leave
`players[]`. That is the fix, but it reads as a regression on a dashboard — `server.ai`
ships in the same change so the difference is visibly accounted for.

Detection is layered: an exact `eAIBase.Cast()` from the AI compat PBO, falling back to a
classname-prefix heuristic in the core. `AiInfo.source` reports which answered, and the
side panel says so rather than implying certainty. `IsAI()` is **not** vanilla — it is
added by Expansion AI's modded `DayZPlayerImplement` — and `#ifdef EXPANSIONMODAI` cannot
guard it, because that PBO declares `EXPANSIONAI_ONFACTIONCHANGE` and defines are gathered
globally from every `CfgMods defines[]` before compilation. Hence the separate PBO.

A logged-out player's body also has a null identity, so identity-null cannot mean "AI".
Anything the classifier does not claim is dropped from **both** lists: a body whose owner
has gone is neither an online player nor a bot, and drawing it as either would be a lie.

**The AI layer's only source is the mod**, which makes staleness behave differently from
every other mod-fed field. For players the mod merely enriches, so stale means "stop
overwriting". Here it must *clear* the layer (`mod_offline`) — holding the last known list
would paint permanent ghost markers across the map after a game-server restart.
`mod_no_ai` is the distinct case where the mod is connected but sent no `ai` key at all,
i.e. collection is switched off; an empty array means detection ran and found none.

### Known limitation

**AI cannot render on a server with no CF Tools binding.** `buildLiveSnapshot` returns
`{connected: false}` before building any layer when `resolveBinding` fails, and
`LiveMapView` shows the "not connected" empty state whenever `!status.connected`. AI need
no CF Tools at all, yet are unreachable without it. Ungating the map is a larger change
and was not attempted here.

## Non-goals

- Replacing the `/ingest` command channel — it stays primary (locality, no
  subscription dependency, result round-trips built in).
- Nested-loadout spawning over GameLabs — `CFCloud_SpawnPlayerItem` cannot
  preserve attachment/cargo nesting; full-fidelity spawn would be a new
  spacecat capability (`Spacecat_SpawnLoadout` taking a JSON tree), which fits
  the extension model above if ever needed.
