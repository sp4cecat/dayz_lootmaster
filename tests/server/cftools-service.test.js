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

import * as cf from '../../server/cftools-client.js';
import * as cfg from '../../server/cftools-config.js';
import {
  buildStatus, buildLiveSnapshot, resolveActionCode, spawnLoadout,
} from '../../server/cftools-service.js';

const PROFILE = { id: 'p1', name: 'Test', serverPath: 'X:\\srv', missionName: 'dayzOffline.chernarusplus' };

beforeEach(() => {
  vi.clearAllMocks();
  cfg._resetState();
  cfg.setAppCredentials({ applicationId: 'app', secret: 's' });
  cfg.setServerBinding('p1', 'api-1', 'Test Server');
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
            live: { loaded: true, ping: { actual: 42, trend: 0 }, position: { latest: [1200.5, 30, 4500.25] } },
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
    });
    // No position → null (marker omitted client-side), row itself survives.
    expect(snap.players.items[1].position).toBeNull();
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
