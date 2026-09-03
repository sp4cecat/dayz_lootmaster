import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub the HTTP client (keep CfToolsError real — the service constructs it).
vi.mock('../../server/cftools-client.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getServerInfo: vi.fn(),
    getGrants: vi.fn(),
    getSessions: vi.fn(),
    getVehicles: vi.fn(),
    getEvents: vi.fn(),
    getGameLabsActions: vi.fn(),
    postGameLabsAction: vi.fn(),
  };
});

// Stub the companion-mod ingest store: it's a module singleton whose snapshot
// freshness is wall-clock based, so faking it keeps the merge tests order-independent.
vi.mock('../../server/ingest-store.js', () => ({
  modConnected: vi.fn(() => false),
  getSnapshot: vi.fn(() => ({ data: null, at: 0 })),
  getTypeDetail: vi.fn(() => null),
}));

import * as cf from '../../server/cftools-client.js';
import * as cfg from '../../server/cftools-config.js';
import * as ingest from '../../server/ingest-store.js';
import {
  buildStatus, buildLiveSnapshot, buildRawEntities, resolveActionCode, spawnLoadout, teleportPlayer,
  spawnItemWorld, spawnAiWorld, startAirdrop, spawnPileWorld, spawnPileFlat, teleportAll,
  resolveWorldActions,
  _resetSpawnLedger,
} from '../../server/cftools-service.js';

const PROFILE = { id: 'p1', name: 'Test', serverPath: 'X:\\srv', missionName: 'dayzOffline.chernarusplus' };

beforeEach(() => {
  vi.clearAllMocks();
  cfg._resetState();
  _resetSpawnLedger();
  cfg.setAppCredentials({ applicationId: 'app', secret: 's' });
  cfg.setServerBinding('p1', 'api-1', 'Test Server');
  // Default: no companion mod. Merge tests opt in.
  ingest.modConnected.mockReturnValue(false);
  ingest.getSnapshot.mockReturnValue({ data: null, at: 0 });
  ingest.getTypeDetail.mockReturnValue(null);
});

describe('degradation reasons', () => {
  it('not_configured without app credentials', async () => {
    cfg.clearAppCredentials();
    expect(await buildStatus(PROFILE)).toEqual({ connected: false, reason: 'not_configured' });
  });

  it('no_profile without a profile, no_api_id without a binding', async () => {
    expect(await buildStatus(null)).toEqual({ connected: false, reason: 'no_profile' });
    cfg.setServerBinding('p1', null);
    expect(await buildStatus(PROFILE)).toEqual({ connected: false, reason: 'no_api_id' });
  });

  it('propagates the client error reason', async () => {
    cf.getServerInfo.mockRejectedValue(new cf.CfToolsError('no_grant', 'nope'));
    expect(await buildStatus(PROFILE)).toMatchObject({ connected: false, reason: 'no_grant' });
  });
});

describe('buildStatus capabilities', () => {
  const infoWithCapabilities = (capabilities) => ({
    at: 1, stale: false,
    data: {
      server: {
        _object: { nickname: 'Zen Chernarus' },
        gameserver: { game_integration: { status: true, capabilities } },
      },
    },
  });

  it('detects GameLabs from a non-empty actions list even when capability strings are silent', async () => {
    // Observed live on staging: GameLabs connected and reporting, yet no
    // "gamelabs" string in game_integration.capabilities. The actions probe is
    // the authoritative signal.
    cf.getServerInfo.mockResolvedValue(infoWithCapabilities(['gsm', 'update']));
    cf.getGameLabsActions.mockResolvedValue({
      at: 1, stale: false, data: { available_actions: [{ actionCode: 'CFCloud_TeleportPlayer' }] },
    });
    const status = await buildStatus(PROFILE);
    expect(status).toMatchObject({
      connected: true,
      nickname: 'Zen Chernarus',
      capabilities: { gsm: true, gameLabs: true },
    });
  });

  it('reports gameLabs false when the actions list is empty (mod not installed)', async () => {
    cf.getServerInfo.mockResolvedValue(infoWithCapabilities(['gsm']));
    cf.getGameLabsActions.mockResolvedValue({ at: 1, stale: false, data: { available_actions: [] } });
    const status = await buildStatus(PROFILE);
    expect(status.capabilities.gameLabs).toBe(false);
  });

  it('falls back to capability strings when the actions probe fails', async () => {
    cf.getServerInfo.mockResolvedValue(infoWithCapabilities(['GameLabs_Actions']));
    cf.getGameLabsActions.mockRejectedValue(new cf.CfToolsError('rate_limited', 'slow down'));
    const status = await buildStatus(PROFILE);
    expect(status.capabilities.gameLabs).toBe(true);
  });
});

describe('buildLiveSnapshot', () => {
  it('normalizes players and tolerates a missing live position', async () => {
    cf.getSessions.mockResolvedValue({
      at: 10, stale: false,
      data: {
        sessions: [
          {
            id: 'sess-1', cftools_id: 'cf-1',
            gamedata: { player_name: 'Alice', steam64: '765...1' },
            info: { ban_count: 0 },
            // Wire order is [x, z, height] (verified live) — the app reorders to [x, height, z].
            // health/item are opportunistic: no Data API route carries them today.
            live: { loaded: true, ping: { actual: 42, trend: 0 }, position: { latest: [1200.5, 4500.25, 30] }, health: 87.4, item: 'M4A1' },
          },
          {
            id: 'sess-2', cftools_id: 'cf-2',
            gamedata: { player_name: 'StillLoading', steam64: '765...2' },
            live: { loaded: false, position: {} },
          },
        ],
      },
    });
    const snap = await buildLiveSnapshot(PROFILE, ['players']);
    expect(snap.connected).toBe(true);
    expect(snap.players.items).toHaveLength(2);
    expect(snap.players.items[0]).toMatchObject({
      name: 'Alice', steamId: '765...1', ping: 42, position: [1200.5, 30, 4500.25],
      health: 87.4, handItem: 'M4A1',
    });
    // No position → null (marker omitted client-side), row itself survives.
    expect(snap.players.items[1].position).toBeNull();
    // Sessions without the opportunistic health/item fields normalize to null.
    expect(snap.players.items[1]).toMatchObject({ health: null, handItem: null });
  });

  // The companion mod's /ingest/snapshot is the only source of live health and
  // item-in-hands — CF Tools' Data API carries neither.
  describe('companion-mod enrichment', () => {
    const sessionsWith = (...players) => {
      cf.getSessions.mockResolvedValue({ at: 10, stale: false, data: { sessions: players } });
    };
    const session = (name, steam64) => ({
      id: `sess-${name}`, cftools_id: `cf-${name}`,
      gamedata: { player_name: name, steam64 },
      live: { loaded: true, position: { latest: [100, 200, 5] } },
    });
    const modUp = (...players) => {
      ingest.modConnected.mockReturnValue(true);
      ingest.getSnapshot.mockReturnValue({ data: { players }, at: 1 });
    };

    it('merges health and item-in-hands onto the roster, joined by steam64', async () => {
      sessionsWith(session('Alice', '765...1'));
      modUp({ name: 'Someone Else', steamId: '765...1', health: 62.5, hands: 'M4A1', alive: 1 });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({ health: 62.5, handItem: 'M4A1' });
    });

    it('falls back to the in-game name when CF Tools has no steam64 yet', async () => {
      sessionsWith(session('Alice', null));
      modUp({ name: 'alice', id: '765...1', health: 71, hands: 'AKM', alive: 1 });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({ health: 71, handItem: 'AKM' });
    });

    it('resolves a friendly label for the hands classname from the mod catalog', async () => {
      sessionsWith(session('Alice', '765...1'));
      modUp({ steamId: '765...1', health: 50, hands: 'M4A1', alive: 1 });
      ingest.getTypeDetail.mockReturnValue({ displayName: 'M4-A1' });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0].handItemLabel).toBe('M4-A1');
    });

    it('leaves handItemLabel null when the catalog has no entry', async () => {
      sessionsWith(session('Alice', '765...1'));
      modUp({ steamId: '765...1', health: 50, hands: 'Modded_Gun', alive: 1 });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({ handItem: 'Modded_Gun', handItemLabel: null });
    });

    it('surfaces the mod-only stats (blood/shock/energy/water/alive)', async () => {
      sessionsWith(session('Alice', '765...1'));
      modUp({
        steamId: '765...1', health: 62.5, blood: 4800, shock: 42,
        energy: 1200, water: 900, alive: true, hands: 'M4A1',
      });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({
        blood: 4800, shock: 42, energy: 1200, water: 900, alive: true,
      });
    });

    it("treats the mod's -1 stat sentinel as unknown, not as a reading", async () => {
      sessionsWith(session('Alice', '765...1'));
      // StatValue() returns -1 when the engine doesn't declare the stat.
      modUp({ steamId: '765...1', health: 62.5, blood: 4800, energy: -1, water: -1, alive: true });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({ blood: 4800, energy: null, water: null });
    });

    it('accepts alive as either a bool or the 0|1 the contract declares', async () => {
      sessionsWith(session('Alice', '765...1'), session('Bob', '765...2'));
      modUp(
        { steamId: '765...1', alive: 0 },
        { steamId: '765...2', alive: 1 },
      );
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0].alive).toBe(false);
      expect(snap.players.items[1].alive).toBe(true);
    });

    it('leaves stats null when the mod omits them entirely', async () => {
      sessionsWith(session('Alice', '765...1'));
      modUp({ steamId: '765...1', health: 62.5 });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({
        health: 62.5, blood: null, shock: null, energy: null, water: null, alive: null,
      });
    });

    it('keeps health but drops hands for a dead player', async () => {
      sessionsWith(session('Alice', '765...1'));
      modUp({ steamId: '765...1', health: 0, hands: 'M4A1', alive: 0 });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({ health: 0, handItem: null });
    });

    it('does not enrich when the mod is disconnected', async () => {
      sessionsWith(session('Alice', '765...1'));
      // Snapshot data present but stale — modConnected() is the only gate.
      ingest.getSnapshot.mockReturnValue({
        data: { players: [{ steamId: '765...1', health: 99, hands: 'M4A1', alive: 1 }] }, at: 1,
      });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({ health: null, handItem: null });
    });

    it('ignores snapshot players with no matching session (no phantom markers)', async () => {
      sessionsWith(session('Alice', '765...1'));
      modUp({ name: 'Ghost', steamId: '765...9', health: 40, hands: 'AKM', alive: 1 });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items).toHaveLength(1);
      expect(snap.players.items[0]).toMatchObject({ name: 'Alice', health: null, handItem: null });
    });

    it("does not overwrite values CF Tools itself provided", async () => {
      const s = session('Alice', '765...1');
      s.live.health = 87.4;
      s.live.item = 'Sporter22';
      sessionsWith(s);
      modUp({ steamId: '765...1', health: 12, hands: 'M4A1', alive: 1 });
      const snap = await buildLiveSnapshot(PROFILE, ['players']);
      expect(snap.players.items[0]).toMatchObject({ health: 87.4, handItem: 'Sporter22' });
    });
  });

  it('splits territory flags out of the events layer', async () => {
    cf.getEvents.mockResolvedValue({
      at: 10, stale: false,
      data: {
        entities: [
          { id: 'e1', type: 'helicrash', classname: 'Wreck_Mi8', position: [100, 0, 200] },
          { id: 'e2', classname: 'TerritoryFlag', position: [300, 0, 400] },
        ],
      },
    });
    const snap = await buildLiveSnapshot(PROFILE, ['events', 'territories']);
    expect(snap.events.items.map(e => e.id)).toEqual(['e1']);
    expect(snap.territories.items.map(e => e.id)).toEqual(['e2']);
    expect(snap.territories.items[0].type).toBe('territory_flag');
  });

  it('classifies heli crash sites separately from car/train wrecks (regression: staging Deer Isle)', async () => {
    // Real classnames observed live: bare Wreck_* are heli crash sites, while
    // Land_Wreck_* (abandoned cars) and StaticObj_Wreck_Train_* must not get
    // the helicrash icon.
    cf.getEvents.mockResolvedValue({
      at: 10, stale: false,
      data: {
        entities: [
          { id: 'h1', classname: 'Wreck_UH1Y', position: [1, 0, 2] },
          { id: 'w1', classname: 'Land_Wreck_hb01_aban1_police_DE', position: [3, 0, 4] },
          { id: 'w2', classname: 'StaticObj_Wreck_Train_742_Red_DE', position: [5, 0, 6] },
        ],
      },
    });
    const snap = await buildLiveSnapshot(PROFILE, ['events']);
    const types = Object.fromEntries(snap.events.items.map(e => [e.id, e.type]));
    expect(types).toEqual({ h1: 'helicrash', w1: 'wreck', w2: 'wreck' });
  });

  it('degrades one failing layer without blanking the others', async () => {
    cf.getSessions.mockResolvedValue({ at: 1, stale: false, data: { sessions: [] } });
    cf.getVehicles.mockRejectedValue(new cf.CfToolsError('rate_limited', 'slow down'));
    cf.getEvents.mockResolvedValue({ at: 1, stale: false, data: { entities: [] } });
    const snap = await buildLiveSnapshot(PROFILE, ['players', 'vehicles', 'events']);
    expect(snap.players).toMatchObject({ items: [] });
    expect(snap.vehicles).toEqual({ error: 'rate_limited', items: [] });
    expect(snap.events).toMatchObject({ items: [] });
  });

  it('drops entities without a usable position', async () => {
    cf.getVehicles.mockResolvedValue({
      at: 1, stale: false,
      data: { entities: [{ id: 'v1', classname: 'OffroadHatchback' }, { id: 'v2', classname: 'Sedan', position: [5, 0, 6] }] },
    });
    const snap = await buildLiveSnapshot(PROFILE, ['vehicles']);
    expect(snap.vehicles.items.map(v => v.id)).toEqual(['v2']);
  });

  it('normalizes the 2-element [x, z] positions the GameLabs entities endpoints return', async () => {
    // Real wire shape (cftools.js types): position: [number, number] — no height.
    cf.getVehicles.mockResolvedValue({
      at: 1, stale: false,
      data: { entities: [{ id: 'v1', className: 'OffroadHatchback', position: [4200.5, 9800.25], speed: 12, health: 900 }] },
    });
    cf.getEvents.mockResolvedValue({
      at: 1, stale: false,
      data: { entities: [{ id: 'e1', className: 'Wreck_Mi8', position: [100, 200] }] },
    });
    const snap = await buildLiveSnapshot(PROFILE, ['vehicles', 'events']);
    expect(snap.vehicles.items[0].position).toEqual([4200.5, 0, 9800.25]);
    expect(snap.events.items[0].position).toEqual([100, 0, 200]);
  });
});

describe('spawn ledger', () => {
  const eventsPayload = (entities, stale = false) => ({ at: 1, stale, data: { entities } });
  const keycard = (position) => ({ id: 'e1', classname: 'KMUC Keycard', position });

  it('flags an event as moved once it leaves its first-seen position', async () => {
    cf.getEvents.mockResolvedValueOnce(eventsPayload([keycard([1000, 0, 2000])]));
    let snap = await buildLiveSnapshot(PROFILE, ['events']);
    expect(snap.events.items[0]).toMatchObject({ moved: false, spawnPosition: [1000, 0, 2000] });

    // Within the 2m settle tolerance: still "at spawn".
    cf.getEvents.mockResolvedValueOnce(eventsPayload([keycard([1001, 0, 2001])]));
    snap = await buildLiveSnapshot(PROFILE, ['events']);
    expect(snap.events.items[0].moved).toBe(false);

    // Carried across the map: moved, spawnPosition preserved.
    cf.getEvents.mockResolvedValueOnce(eventsPayload([keycard([5000, 0, 9000])]));
    snap = await buildLiveSnapshot(PROFILE, ['events']);
    expect(snap.events.items[0]).toMatchObject({ moved: true, spawnPosition: [1000, 0, 2000] });
  });

  it('prunes vanished ids on fresh payloads so a respawn is a new spawn point', async () => {
    cf.getEvents.mockResolvedValueOnce(eventsPayload([keycard([1000, 0, 2000])]));
    await buildLiveSnapshot(PROFILE, ['events']);

    // Item despawned (fresh payload without it) — ledger entry drops.
    cf.getEvents.mockResolvedValueOnce(eventsPayload([]));
    await buildLiveSnapshot(PROFILE, ['events']);

    // Same id reappears elsewhere (network ids recycle after a server restart):
    // treated as a fresh spawn, not as "moved".
    cf.getEvents.mockResolvedValueOnce(eventsPayload([keycard([7000, 0, 7000])]));
    const snap = await buildLiveSnapshot(PROFILE, ['events']);
    expect(snap.events.items[0]).toMatchObject({ moved: false, spawnPosition: [7000, 0, 7000] });
  });

  it('does not prune the ledger from a stale-served payload', async () => {
    cf.getEvents.mockResolvedValueOnce(eventsPayload([keycard([1000, 0, 2000])]));
    await buildLiveSnapshot(PROFILE, ['events']);

    // Rate-limited: stale serve without the item must NOT wipe its spawn entry.
    cf.getEvents.mockResolvedValueOnce(eventsPayload([], true));
    await buildLiveSnapshot(PROFILE, ['events']);

    cf.getEvents.mockResolvedValueOnce(eventsPayload([keycard([5000, 0, 9000])]));
    const snap = await buildLiveSnapshot(PROFILE, ['events']);
    expect(snap.events.items[0]).toMatchObject({ moved: true, spawnPosition: [1000, 0, 2000] });
  });
});

describe('territory tooltip parsing', () => {
  // Exactly the shape SGL_TerritoryFlag.c builds: <b> title, <br/> separators,
  // &middot; between the Territory fields, &nbsp; roster indent.
  const tooltip = [
    '<b>Northwood</b>',
    'Flag Level: 87 %',
    'Remaining Lifetime: ~ 41 hours',
    'Owner: PlayerOne (76561198000000000)',
    'Territory: #4 &middot; Level 2 &middot; 3 member(s)',
    '<b>Members</b>:',
    '&nbsp;&nbsp;PlayerTwo (76561198000000001) - Moderator',
    '&nbsp;&nbsp;PlayerThree (76561198000000002) - Member',
  ].join('<br/>');

  const flagWith = (displayName) => ({
    at: 1, stale: false,
    data: { entities: [{ id: 'f1', classname: 'TerritoryFlag', display_name: displayName, position: [1000, 0, 2000] }] },
  });

  const territoryFrom = async (displayName) => {
    cf.getEvents.mockResolvedValueOnce(flagWith(displayName));
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);
    return snap.territories.items[0];
  };

  it('parses the enriched tooltip into structured fields', async () => {
    const flag = await territoryFrom(tooltip);
    expect(flag.territory).toMatchObject({
      name: 'Northwood',
      flagLevel: 87,
      lifetimeHours: 41,
      owner: { name: 'PlayerOne', steamId: '76561198000000000' },
      territoryId: 4,
      level: 2,
      memberCount: 3,
      membersOmitted: 0,
    });
    expect(flag.territory.members).toEqual([
      { name: 'PlayerTwo', steamId: '76561198000000001', rank: 'Moderator' },
      { name: 'PlayerThree', steamId: '76561198000000002', rank: 'Member' },
    ]);
  });

  it('replaces the markup displayName with the plain territory name', async () => {
    // Otherwise the marker title and panel heading render a wall of HTML.
    const flag = await territoryFrom(tooltip);
    expect(flag.displayName).toBe('Northwood');
  });

  it('decodes the entities the mod escapes player-supplied text with', async () => {
    const flag = await territoryFrom(
      '<b>Ben &amp; Jerry&#39;s &lt;HQ&gt;</b><br/>Owner: A&amp;B (76561198000000000)<br/>Territory: #3 &middot; Level 1 &middot; 1 member(s)',
    );
    expect(flag.territory.name).toBe("Ben & Jerry's <HQ>");
    expect(flag.territory.owner.name).toBe('A&B');
  });

  it('handles an empty roster and a bare-UID owner', async () => {
    const flag = await territoryFrom(
      '<b>Camp</b><br/>Owner: 76561198000000009<br/>Territory: #7 &middot; Level 1 &middot; 1 member(s)<br/><b>Members</b>: none',
    );
    expect(flag.territory.owner).toEqual({ name: null, steamId: '76561198000000009' });
    expect(flag.territory.members).toEqual([]);
  });

  it('records how many members the mod capped off the roster', async () => {
    const flag = await territoryFrom(
      '<b>Big</b><br/>Territory: #1 &middot; Level 3 &middot; 40 member(s)<br/><b>Members</b>:<br/>&nbsp;&nbsp;B (76561198000000001) - Member<br/>&nbsp;&nbsp;... and 38 more',
    );
    expect(flag.territory.memberCount).toBe(40);
    expect(flag.territory.members).toHaveLength(1);
    expect(flag.territory.membersOmitted).toBe(38);
  });

  it('keeps names intact when territory_show_uids is off', async () => {
    const flag = await territoryFrom(
      '<b>Quiet</b><br/>Owner: Solo<br/>Territory: #2 &middot; Level 1 &middot; 2 member(s)<br/><b>Members</b>:<br/>&nbsp;&nbsp;Mate - Admin',
    );
    expect(flag.territory.owner).toEqual({ name: 'Solo', steamId: null });
    expect(flag.territory.members[0]).toEqual({ name: 'Mate', steamId: null, rank: 'Admin' });
  });

  it('splits a member name containing " - " on the rank, not the name', async () => {
    const flag = await territoryFrom(
      '<b>T</b><br/>Territory: #1 &middot; Level 1 &middot; 2 member(s)<br/><b>Members</b>:<br/>&nbsp;&nbsp;Bob - the - Builder (76561198000000005) - Moderator',
    );
    expect(flag.territory.members[0]).toMatchObject({ name: 'Bob - the - Builder', rank: 'Moderator' });
  });

  it('leaves an unrecognised tooltip untouched rather than blanking it', async () => {
    // A flag still on GameLabs' own baseline marker, or a future wording change.
    const flag = await territoryFrom('Territory Flag');
    expect(flag.territory).toBeUndefined();
    expect(flag.displayName).toBe('Territory Flag');
  });

  it('flattens an unparsed markup tooltip so the panel title has no raw tags', async () => {
    const flag = await territoryFrom('<b>Territory Flag</b><br/>Something we do not recognise');
    expect(flag.territory).toBeUndefined();
    expect(flag.displayName).toBe('Territory Flag');
  });
});

// The field names below are not documented by CF Tools. GameLabs uploads camelCase
// (`_ServerEvent` in Scripts/3_Game/API/definitions.c) while the Data API is snake_case
// elsewhere, so each of these renames silently empties part of the map instead of
// erroring — which is exactly how a territory flag ends up clickable but blank.
describe('GameLabs payload shape tolerance', () => {
  const TOOLTIP = '<b>Northwood</b><br/>Owner: PlayerOne (76561198000000000)'
    + '<br/>Territory: #4 &middot; Level 2 &middot; 3 member(s)';

  const eventsPayload = (entity) => ({ at: 1, stale: false, data: { entities: [entity] } });

  it('reads the tooltip from `name` when the label field is renamed', async () => {
    cf.getEvents.mockResolvedValueOnce(eventsPayload({
      id: 'f1', className: 'TerritoryFlag', name: TOOLTIP, position: [1000, 0, 2000],
    }));
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);
    expect(snap.territories.items[0].territory).toMatchObject({ name: 'Northwood', territoryId: 4 });
  });

  it('accepts an Enforce vector serialised as a string instead of dropping the entity', async () => {
    cf.getEvents.mockResolvedValueOnce(eventsPayload({
      id: 'f1', className: 'TerritoryFlag', displayName: TOOLTIP, position: '<1000, 5.5, 2000>',
    }));
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);
    expect(snap.territories.items).toHaveLength(1);
    expect(snap.territories.items[0].position).toEqual([1000, 5.5, 2000]);
  });

  it('accepts a space-separated vector string too', async () => {
    cf.getEvents.mockResolvedValueOnce(eventsPayload({
      id: 'e1', classname: 'Wreck_UH1Y', position: '7500 300 2500',
    }));
    const snap = await buildLiveSnapshot(PROFILE, ['events']);
    expect(snap.events.items[0].position).toEqual([7500, 300, 2500]);
  });

  it('still drops an entity whose position is unusable', async () => {
    cf.getEvents.mockResolvedValueOnce(eventsPayload({ id: 'e1', classname: 'X', position: 'nope' }));
    const snap = await buildLiveSnapshot(PROFILE, ['events']);
    expect(snap.events.items).toEqual([]);
  });
});

describe('buildRawEntities', () => {
  it('reports the envelope and entity key names, and caps the sample', async () => {
    cf.getEvents.mockResolvedValueOnce({
      at: 7, stale: false,
      data: {
        status: true,
        entities: [
          { id: 'a', className: 'TerritoryFlag', displayName: '<b>N</b>', position: [1, 0, 2] },
          { id: 'b', className: 'SeaChest', icon: 'box-open', position: [3, 0, 4] },
        ],
      },
    });
    const raw = await buildRawEntities(PROFILE, 'events', 1);
    expect(raw.connected).toBe(true);
    expect(raw.envelopeKeys).toEqual(['status', 'entities']);
    expect(raw.keys).toEqual(['className', 'displayName', 'icon', 'id', 'position']);
    expect(raw.count).toBe(2);
    expect(raw.entities).toHaveLength(1);
    expect(raw.entities[0]).toEqual({ id: 'a', className: 'TerritoryFlag', displayName: '<b>N</b>', position: [1, 0, 2] });
  });

  it('reports an unrecognised envelope as zero entities with its key names intact', async () => {
    cf.getEvents.mockResolvedValueOnce({ at: 7, stale: false, data: { status: true, markers: [{ id: 'a' }] } });
    const raw = await buildRawEntities(PROFILE, 'events', 25);
    expect(raw.count).toBe(0);
    expect(raw.envelopeKeys).toEqual(['status', 'markers']);
  });

  it('degrades with a reason rather than throwing', async () => {
    cf.getEvents.mockRejectedValueOnce(new cf.CfToolsError('no_grant', 'nope'));
    expect(await buildRawEntities(PROFILE, 'events', 25)).toEqual({ connected: false, reason: 'no_grant' });
  });
});

// The mod reads BasicTerritories/Expansion in-process on the game server, so it is a
// strictly better source than the GameLabs tooltip — but the tooltip is still the only
// source when the mod is stale, so the two have to coexist rather than one replacing
// the other.
describe('companion-mod territories', () => {
  const TOOLTIP = '<b>Northwood</b><br/>Flag Level: 87 %<br/>Remaining Lifetime: ~ 41 hours'
    + '<br/>Owner: PlayerOne (76561198000000000)'
    + '<br/>Territory: #4 &middot; Level 2 &middot; 3 member(s)';

  const glFlagAt = (x, z, displayName = TOOLTIP) => {
    cf.getEvents.mockResolvedValueOnce({
      at: 5, stale: false,
      data: { entities: [{ id: 'f1', classname: 'TerritoryFlag', display_name: displayName, position: [x, 0, z] }] },
    });
  };
  const modUp = (territories) => {
    ingest.modConnected.mockReturnValue(true);
    ingest.getSnapshot.mockReturnValue({ data: { territories }, at: 99 });
  };
  // A row shaped exactly as the mod's SpacecatTerritoryInfo serialises it, sentinels
  // and all — "" for an undeclared string, -1 for an undeclared number, 1/0 for bools.
  const modFlag = (over = {}) => ({
    key: '1000_2000', cls: 'TerritoryFlag', pos: [1000, 0, 2000],
    system: 'basic', systems: ['basic'],
    ownerId: 'GUID-OWNER', ownerSteamId: '76561198000000000', ownerName: 'PlayerOne', claimed: 1,
    name: '', territoryId: -1, level: -1,
    memberCount: 2,
    members: [
      { id: 'GUID-A', steamId: '76561198000000001', name: 'Bob', rank: '', perms: 6, permissionNames: ['build', 'dismantle'], online: 1 },
      { id: 'GUID-B', steamId: '', name: '', rank: '', perms: -1, permissionNames: [], online: 0 },
    ],
    membersTruncated: 0,
    refresher01: 0.42, active: 1,
    objects: 73, cargo: 412, radius: 150, scanAge: 30,
    ...over,
  });

  it('merges the mod row onto the GameLabs flag it matches by position', async () => {
    glFlagAt(1000, 2000);
    modUp([modFlag()]);
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);

    expect(snap.territories.items).toHaveLength(1);
    const t = snap.territories.items[0];
    expect(t.origin).toBe('mixed');
    expect(t.territory.objectCount).toBe(73);
    expect(t.territory.cargoCount).toBe(412);
    // The mod's roster is complete, so it replaces the tooltip's capped one.
    expect(t.territory.members.map(m => m.id)).toEqual(['GUID-A', 'GUID-B']);
    // ...and the tooltip fills what the mod does not compute.
    expect(t.territory.lifetimeHours).toBe(41);
  });

  it('collapses the mod\'s "" and -1 sentinels to null rather than rendering them', async () => {
    // No GameLabs flag to merge with, so what survives is purely the mod's row.
    cf.getEvents.mockResolvedValueOnce({ at: 5, stale: false, data: { entities: [] } });
    modUp([modFlag()]);
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);
    const t = snap.territories.items[0].territory;

    // BasicTerritories declares no territory name, id or level at all — the mod sends
    // "" / -1 for those, and rendering them literally gives "Level -1".
    expect(t.name).toBeNull();
    expect(t.territoryId).toBeNull();
    expect(t.level).toBeNull();
    expect(t.lifetimeHours).toBeNull();
    // A member the GUID ledger could not resolve keeps its id and nothing more.
    const unresolved = t.members.find(m => m.id === 'GUID-B');
    expect(unresolved).toMatchObject({ name: null, steamId: null, permissions: null, rank: null });
    // refresher01 is 0..1 on the wire; the tooltip reports whole percent. Both land
    // in the same unit so the panel does not have to know which source it got.
    expect(t.flagLevel).toBe(42);
  });

  // The other half of "mod wins per-field": where the mod's value is a sentinel, the
  // tooltip's real value must survive rather than being overwritten with null.
  it('lets the tooltip fill fields the mod declares as undeclared', async () => {
    glFlagAt(1000, 2000);
    modUp([modFlag()]); // territoryId/level are -1, name is ""
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);
    const t = snap.territories.items[0].territory;

    expect(t.territoryId).toBe(4);
    expect(t.level).toBe(2);
    expect(t.name).toBe('Northwood');
    // ...while the mod still wins where it actually has a value.
    expect(t.flagLevel).toBe(42); // not the tooltip's 87
  });

  it('appends a mod flag that no GameLabs marker matches', async () => {
    glFlagAt(1000, 2000);
    modUp([modFlag(), modFlag({ key: '5000_6000', pos: [5000, 0, 6000] })]);
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);

    expect(snap.territories.items).toHaveLength(2);
    const appended = snap.territories.items.find(i => i.origin === 'mod');
    expect(appended.id).toBe('mod:5000_6000');
    expect(appended.type).toBe('territory_flag');
    expect(appended.position).toEqual([5000, 0, 6000]);
  });

  it('does not cross-assign a mod row to a flag beyond the join epsilon', async () => {
    glFlagAt(1000, 2000);
    modUp([modFlag({ key: '1050_2000', pos: [1050, 0, 2000] })]); // 50 m away
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);
    expect(snap.territories.items).toHaveLength(2);
    expect(snap.territories.items.map(i => i.origin).sort()).toEqual(['gamelabs', 'mod']);
  });

  it('carries the layer from the mod alone when the GameLabs upstream fails', async () => {
    cf.getEvents.mockRejectedValueOnce(new cf.CfToolsError('no_grant', 'nope'));
    modUp([modFlag()]);
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);

    expect(snap.territories.items).toHaveLength(1);
    expect(snap.territories.source).toBe('mod');
    // Must NOT carry `error` — the UI reads that as "empty, show unavailable".
    expect(snap.territories.error).toBeUndefined();
  });

  it('leaves the tooltip-only layer exactly as it was when the mod is stale', async () => {
    glFlagAt(1000, 2000);
    ingest.modConnected.mockReturnValue(false);
    ingest.getSnapshot.mockReturnValue({ data: { territories: [modFlag()] }, at: 99 });
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);

    const t = snap.territories.items[0];
    expect(t.origin).toBe('gamelabs');
    expect(t.territory.objectCount).toBeUndefined();
    expect(t.territory.name).toBe('Northwood');
  });

  it('drops a mod row with no usable position instead of placing it at the origin', async () => {
    glFlagAt(1000, 2000);
    modUp([modFlag({ key: 'bad', pos: null })]);
    const snap = await buildLiveSnapshot(PROFILE, ['territories']);
    expect(snap.territories.items).toHaveLength(1);
    expect(snap.territories.items[0].origin).toBe('gamelabs');
  });
});

describe('companion-mod AI layer', () => {
  const aiRow = (over = {}) => ({
    id: '12:34', cls: 'eAI_SurvivorM_Mirek', name: 'Mirek',
    faction: 'Raiders', group: 'Patrol-1', groupId: 7,
    pos: [7500, 300, 2500],
    health: 88, blood: 5000, shock: 100, energy: -1, water: -1, heatComfort: -1,
    alive: 1, hands: 'M4A1', source: 'expansion',
    ...over,
  });
  const modUp = (ai) => {
    ingest.modConnected.mockReturnValue(true);
    ingest.getSnapshot.mockReturnValue({ data: { ai }, at: 42 });
  };

  it('builds the layer from the mod snapshot', async () => {
    modUp([aiRow()]);
    ingest.getTypeDetail.mockReturnValue({ displayName: 'M4-A1' });
    const snap = await buildLiveSnapshot(PROFILE, ['ai']);

    expect(snap.ai.items).toHaveLength(1);
    expect(snap.ai.items[0]).toMatchObject({
      id: '12:34', name: 'Mirek', className: 'eAI_SurvivorM_Mirek',
      faction: 'Raiders', groupId: 7, health: 88, alive: true,
      handItem: 'M4A1', handItemLabel: 'M4-A1', source: 'expansion',
    });
    // -1 is "the engine never declared this stat", not a reading.
    expect(snap.ai.items[0].energy).toBeNull();
    expect(snap.ai.items[0].water).toBeNull();
  });

  // The mod's pos is world [x, y, z]; CF Tools GSM sessions are [x, z, height] and go
  // through normSessionPosition. Using the wrong one here puts every AI on the wrong
  // axis, which looks entirely plausible on a square map.
  it('reads pos as world [x, y, z], not as a CF Tools session vector', async () => {
    modUp([aiRow({ pos: [7500, 300, 2500] })]);
    const snap = await buildLiveSnapshot(PROFILE, ['ai']);
    expect(snap.ai.items[0].position).toEqual([7500, 300, 2500]);
  });

  // The mod is this layer's ONLY source, so staleness must clear it. Holding the last
  // known list would paint permanent ghost bots after a game-server restart.
  it('clears the layer when the mod goes stale rather than freezing it', async () => {
    ingest.modConnected.mockReturnValue(false);
    ingest.getSnapshot.mockReturnValue({ data: { ai: [aiRow()] }, at: 42 });
    const snap = await buildLiveSnapshot(PROFILE, ['ai']);
    expect(snap.ai).toEqual({ error: 'mod_offline', items: [] });
  });

  // Key absent = AI collection switched off mod-side; empty array = it ran and found
  // none. Those are different claims and the UI says so.
  it('distinguishes "no AI source" from "a source that found none"', async () => {
    modUp(undefined);
    expect((await buildLiveSnapshot(PROFILE, ['ai'])).ai).toEqual({ error: 'mod_no_ai', items: [] });

    modUp([]);
    const ran = await buildLiveSnapshot(PROFILE, ['ai']);
    expect(ran.ai.items).toEqual([]);
    expect(ran.ai.error).toBeUndefined();
  });

  it('falls back to the classname when the mod has no display name', async () => {
    modUp([aiRow({ name: '' })]);
    const snap = await buildLiveSnapshot(PROFILE, ['ai']);
    expect(snap.ai.items[0].name).toBe('eAI_SurvivorM_Mirek');
  });
});

describe('companion-mod world clock', () => {
  // The world block rides along on every buildLiveSnapshot call, so the requested
  // layer still has to resolve. Set it here rather than relying on a value another
  // describe left on the mock — vi.clearAllMocks() clears calls, not implementations.
  beforeEach(() => {
    cf.getSessions.mockResolvedValue({ at: 1, stale: false, data: { sessions: [] } });
  });

  const modUp = (server) => {
    ingest.modConnected.mockReturnValue(true);
    ingest.getSnapshot.mockReturnValue({ data: { server }, at: 42 });
  };
  const heartbeat = (over = {}) => ({
    online: 3, ai: 0, uptime: 900, fps: 45,
    year: 2020, month: 8, day: 14, hour: 8, minute: 42,
    temperature: 12.4,
    weather: { overcast: 0.2, rain: 0, fog: 0.1 },
    ...over,
  });

  it('reports date, time and temperature from the heartbeat', async () => {
    modUp(heartbeat());
    const snap = await buildLiveSnapshot(PROFILE, ['players']);
    expect(snap.world).toEqual({
      at: 42,
      time: { hour: 8, minute: 42 },
      date: { year: 2020, month: 8, day: 14 },
      temperature: 12.4,
    });
  });

  // The whole point of the -999 sentinel. Temperature is the only numeric on this wire
  // whose valid range spans zero, so the "negative means unknown" rule the bounded
  // stats use would blank out every reading on a winter map.
  it('keeps a sub-zero temperature and only drops the sentinel', async () => {
    modUp(heartbeat({ temperature: -14.2 }));
    expect((await buildLiveSnapshot(PROFILE, ['players'])).world.temperature).toBe(-14.2);

    modUp(heartbeat({ temperature: -999 }));
    expect((await buildLiveSnapshot(PROFILE, ['players'])).world.temperature).toBeNull();
  });

  // Midnight. modStat treats a negative as unknown, which is right here, but 0 is a
  // real hour and a real minute and must survive.
  it('renders midnight rather than dropping it as a falsy reading', async () => {
    modUp(heartbeat({ hour: 0, minute: 0 }));
    expect((await buildLiveSnapshot(PROFILE, ['players'])).world.time).toEqual({ hour: 0, minute: 0 });
  });

  // A mod build older than the one that added `temperature` still reports a usable
  // clock; blanking the whole block would be a regression for anyone yet to redeploy.
  it('still reports the clock when the mod sends no temperature', async () => {
    const older = heartbeat();
    delete older.temperature;
    modUp(older);
    const { world } = await buildLiveSnapshot(PROFILE, ['players']);
    expect(world.temperature).toBeNull();
    expect(world.time).toEqual({ hour: 8, minute: 42 });
  });

  // Half a clock is a wrong time on screen, which is worse than no clock.
  it('withholds a partial clock or date rather than rendering half of one', async () => {
    modUp(heartbeat({ minute: -1 }));
    expect((await buildLiveSnapshot(PROFILE, ['players'])).world.time).toBeNull();

    modUp(heartbeat({ day: 0 }));
    expect((await buildLiveSnapshot(PROFILE, ['players'])).world.date).toBeNull();
  });

  // Mod-only data: CF Tools carries none of it, so a stale snapshot must clear the
  // readout instead of leaving a frozen clock that looks live.
  it('reports mod_offline when the mod goes stale', async () => {
    ingest.modConnected.mockReturnValue(false);
    ingest.getSnapshot.mockReturnValue({ data: { server: heartbeat() }, at: 42 });
    expect((await buildLiveSnapshot(PROFILE, ['players'])).world).toEqual({ error: 'mod_offline' });
  });

  it('reports mod_offline when the mod is up but sent no heartbeat', async () => {
    modUp(undefined);
    expect((await buildLiveSnapshot(PROFILE, ['players'])).world).toEqual({ error: 'mod_offline' });
  });
});

describe('resolveActionCode', () => {
  const actions = [
    { actionCode: 'CFCloud_TeleportPlayer' },
    { actionCode: 'CFCloud_SpawnPlayerItem' },
    { actionCode: 'SomeMod_HealEverything' },
  ];

  it('prefers the exact CFCloud code, falls back to pattern matches', () => {
    expect(resolveActionCode(actions, 'teleport')).toBe('CFCloud_TeleportPlayer');
    expect(resolveActionCode(actions, 'spawn')).toBe('CFCloud_SpawnPlayerItem');
    expect(resolveActionCode(actions, 'heal')).toBe('SomeMod_HealEverything');
  });

  it('returns null when nothing matches (button hides, no dud fires)', () => {
    expect(resolveActionCode(actions, 'kill')).toBeNull();
    expect(resolveActionCode([], 'teleport')).toBeNull();
  });
});

describe('teleportPlayer', () => {
  it('sends the GameLabs wire vector order: valueVectorY = world Z, valueVectorZ = height', async () => {
    cf.getGameLabsActions.mockResolvedValue({
      at: 1, stale: false, data: { actions: [{ actionCode: 'CFCloud_TeleportPlayer' }] },
    });
    cf.postGameLabsAction.mockResolvedValue({});
    await teleportPlayer('api-1', '765...1', { x: 4361, z: 8188 });
    expect(cf.postGameLabsAction).toHaveBeenCalledWith('api-1', expect.objectContaining({
      parameters: {
        // Height 0 → the mod snaps to SurfaceY at (x, z).
        vector: { dataType: 'vector', valueVectorX: 4361, valueVectorY: 8188, valueVectorZ: 0 },
      },
    }));
  });
});

describe('world-context actions', () => {
  const withActions = (...codes) => cf.getGameLabsActions.mockResolvedValue({
    at: 1, stale: false, data: { actions: codes.map(actionCode => ({ actionCode })) },
  });

  beforeEach(() => { cf.postGameLabsAction.mockResolvedValue({}); });

  // The whole point of these actions: a map point, not an entity. A stray
  // referenceKey would make GameLabs resolve an entity and change the meaning.
  it('targets the world with no reference key', async () => {
    withActions('CFCloud_SpawnItemWorld');
    await spawnItemWorld('api-1', { x: 100, z: 200 }, 'M4A1');
    expect(cf.postGameLabsAction).toHaveBeenCalledWith('api-1', expect.objectContaining({
      actionCode: 'CFCloud_SpawnItemWorld',
      actionContext: 'world',
      referenceKey: null,
    }));
  });

  it('packs coordinates in GameLabs order: valueVectorY = world Z, height 0 = surface snap', async () => {
    withActions('CFCloud_SpawnItemWorld', 'Spacecat_SpawnAI', 'Spacecat_StartAirdrop', 'Spacecat_SpawnLoadout');
    const expected = { dataType: 'vector', valueVectorX: 4361, valueVectorY: 8188, valueVectorZ: 0 };
    const at = { x: 4361, z: 8188 };

    await spawnItemWorld('api-1', at, 'M4A1');
    await spawnAiWorld('api-1', at, { kind: 'infected', count: 3 });
    await startAirdrop('api-1', at, 'Military');
    await spawnPileWorld('api-1', at, [{ className: 'M4A1' }]);

    for (const call of cf.postGameLabsAction.mock.calls) {
      expect(call[1].parameters.vector).toEqual(expected);
    }
  });

  it('sends the airdrop mission name as a string parameter', async () => {
    withActions('Spacecat_StartAirdrop');
    await startAirdrop('api-1', { x: 1, z: 2 }, 'Arctica');
    expect(cf.postGameLabsAction).toHaveBeenCalledWith('api-1', expect.objectContaining({
      parameters: expect.objectContaining({
        mission: { dataType: 'string', valueString: 'Arctica' },
      }),
    }));
  });

  it('clamps the AI count to at least one', async () => {
    withActions('Spacecat_SpawnAI');
    await spawnAiWorld('api-1', { x: 1, z: 2 }, { count: 0 });
    expect(cf.postGameLabsAction.mock.calls[0][1].parameters.count).toEqual({ dataType: 'int', valueInt: 1 });
  });

  it('serialises the pile tree so nesting survives the wire', async () => {
    withActions('Spacecat_SpawnLoadout');
    const tree = [{ className: 'M4A1', quantity: 1, attachments: [{ className: 'ACOGOptic', quantity: 1 }] }];
    await spawnPileWorld('api-1', { x: 1, z: 2 }, tree);
    const sent = cf.postGameLabsAction.mock.calls[0][1].parameters.tree;
    expect(sent.dataType).toBe('string');
    expect(JSON.parse(sent.valueString)).toEqual(tree);
  });

  it('reports no_grant when the server does not advertise the action', async () => {
    withActions('CFCloud_TeleportPlayer');
    await expect(spawnAiWorld('api-1', { x: 1, z: 2 })).rejects.toMatchObject({ reason: 'no_grant' });
    await expect(startAirdrop('api-1', { x: 1, z: 2 }, 'M')).rejects.toMatchObject({ reason: 'no_grant' });
  });
});

describe('resolveWorldActions', () => {
  it('reports only what the server advertises', () => {
    const stock = [{ actionCode: 'CFCloud_SpawnItemWorld' }, { actionCode: 'CFCloud_TeleportPlayer' }];
    expect(resolveWorldActions(stock)).toEqual({
      spawnItem: true, spawnAi: false, airdrop: false, spawnPile: false,
    });
  });

  it('lights up the spacecat actions when their PBOs are installed', () => {
    const full = ['CFCloud_SpawnItemWorld', 'Spacecat_SpawnAI', 'Spacecat_StartAirdrop', 'Spacecat_SpawnLoadout']
      .map(actionCode => ({ actionCode }));
    expect(resolveWorldActions(full)).toEqual({
      spawnItem: true, spawnAi: true, airdrop: true, spawnPile: true,
    });
  });
});

describe('player vs world spawn resolution', () => {
  // GameLabs ships BOTH CFCloud_SpawnPlayerItem and CFCloud_SpawnItemWorld, and the
  // old loose pattern (/spawn.*item/i) matched the world one too. If the player action
  // were ever renamed, "spawn on player" would silently fall through to the world
  // action and post a steam64 as its referenceKey.
  it('never resolves the player spawn to the world action', () => {
    expect(resolveActionCode([{ actionCode: 'CFCloud_SpawnItemWorld' }], 'spawn')).toBeNull();
  });

  it('never resolves the world spawn to the player action', () => {
    expect(resolveActionCode([{ actionCode: 'CFCloud_SpawnPlayerItem' }], 'spawnWorld')).toBeNull();
  });

  it('picks the right one when both are present', () => {
    const both = [{ actionCode: 'CFCloud_SpawnItemWorld' }, { actionCode: 'CFCloud_SpawnPlayerItem' }];
    expect(resolveActionCode(both, 'spawn')).toBe('CFCloud_SpawnPlayerItem');
    expect(resolveActionCode(both, 'spawnWorld')).toBe('CFCloud_SpawnItemWorld');
  });
});

describe('teleportAll', () => {
  beforeEach(() => {
    cf.getGameLabsActions.mockResolvedValue({
      at: 1, stale: false, data: { actions: [{ actionCode: 'CFCloud_TeleportPlayer' }] },
    });
  });

  it('names who failed rather than collapsing to one error', async () => {
    cf.postGameLabsAction
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new cf.CfToolsError('unreachable', 'boom'))
      .mockResolvedValueOnce({});
    const players = [
      { steam64: '765...1', name: 'Ann' },
      { steam64: '765...2', name: 'Bo' },
      { steam64: '765...3', name: 'Cy' },
    ];
    const results = await teleportAll('api-1', players, { x: 10, z: 20 }, { delayMs: 0 });
    expect(results).toEqual([
      { steam64: '765...1', name: 'Ann', ok: true },
      { steam64: '765...2', name: 'Bo', ok: false, error: 'unreachable' },
      { steam64: '765...3', name: 'Cy', ok: true },
    ]);
    // One failure must not abort the players behind it.
    expect(cf.postGameLabsAction).toHaveBeenCalledTimes(3);
  });

  it('sends every player to the same point, player-context', async () => {
    await teleportAll('api-1', [{ steam64: 'a' }, { steam64: 'b' }], { x: 7, z: 9 }, { delayMs: 0 });
    for (const call of cf.postGameLabsAction.mock.calls) {
      expect(call[1].actionContext).toBe('player');
      expect(call[1].parameters.vector).toEqual({
        dataType: 'vector', valueVectorX: 7, valueVectorY: 9, valueVectorZ: 0,
      });
    }
  });

  it('skips entries with no steam64 instead of firing a bad reference', async () => {
    const results = await teleportAll('api-1', [{ name: 'ghost' }, { steam64: 'a' }], { x: 1, z: 2 }, { delayMs: 0 });
    expect(results).toHaveLength(1);
    expect(cf.postGameLabsAction).toHaveBeenCalledTimes(1);
  });
});

describe('spawnPileFlat', () => {
  it('spawns each item into the world and reports per-item results', async () => {
    cf.getGameLabsActions.mockResolvedValue({
      at: 1, stale: false, data: { actions: [{ actionCode: 'CFCloud_SpawnItemWorld' }] },
    });
    cf.postGameLabsAction
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new cf.CfToolsError('rate_limited', 'slow down'));
    const results = await spawnPileFlat(
      'api-1', { x: 5, z: 6 },
      [{ className: 'M4A1', quantity: 1 }, { className: 'Mag_STANAG_30Rnd', quantity: 3 }],
      { delayMs: 0 },
    );
    expect(results).toEqual([
      { className: 'M4A1', ok: true },
      { className: 'Mag_STANAG_30Rnd', ok: false, error: 'rate_limited' },
    ]);
    expect(cf.postGameLabsAction.mock.calls[1][1].parameters.quantity).toEqual({ dataType: 'int', valueInt: 3 });
  });
});

describe('spawnLoadout', () => {
  beforeEach(() => {
    cf.getGameLabsActions.mockResolvedValue({
      at: 1, stale: false, data: { actions: [{ actionCode: 'CFCloud_SpawnPlayerItem' }] },
    });
  });

  it('spawns sequentially and reports per-item results on partial failure', async () => {
    cf.postGameLabsAction
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new cf.CfToolsError('unreachable', 'boom'))
      .mockResolvedValueOnce({});
    const results = await spawnLoadout('api-1', '765...1', ['M4A1', 'Mag_STANAG_30Rnd', 'AmmoBox'], { delayMs: 0 });
    expect(results).toEqual([
      { className: 'M4A1', ok: true },
      { className: 'Mag_STANAG_30Rnd', ok: false, error: 'unreachable' },
      { className: 'AmmoBox', ok: true },
    ]);
    // Player-context spawn uses the steam64 as referenceKey.
    expect(cf.postGameLabsAction).toHaveBeenCalledWith('api-1', expect.objectContaining({
      actionCode: 'CFCloud_SpawnPlayerItem',
      actionContext: 'player',
      referenceKey: '765...1',
    }));
  });

  it('throws no_grant when no spawn action is available', async () => {
    cf.getGameLabsActions.mockResolvedValue({ at: 1, stale: false, data: { actions: [] } });
    await expect(spawnLoadout('api-1', '765...1', ['M4A1'], { delayMs: 0 }))
      .rejects.toMatchObject({ reason: 'no_grant' });
  });
});
