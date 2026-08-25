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
  buildStatus, buildLiveSnapshot, resolveActionCode, spawnLoadout, teleportPlayer, _resetSpawnLedger,
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
