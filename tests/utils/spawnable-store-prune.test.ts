import { describe, it, expect } from 'vitest';
import { pruneUndeclaredSpawnableFiles, ROOT_SPAWNABLE_GROUP } from '../../src/utils/xml.js';

describe('pruneUndeclaredSpawnableFiles', () => {
  // Older builds seeded the spawnable store from each group's *types* files, so a cached
  // store can hold a types.xml bucket. An edit landing in it saved over the real types.xml.
  it('drops a bucket keyed by one of the group\'s types files', () => {
    const store = {
      mortys: {
        'types.xml': { types: [{ name: 'TTC_DMR_VFG', sections: [] }] },
        'spawnabletypes.xml': { types: [{ name: 'TTC_UZI', sections: [] }] }
      }
    };
    const removed = pruneUndeclaredSpawnableFiles(store, {
      mortys: ['/samples/db/types/mortys/spawnabletypes.xml']
    });

    expect(removed).toEqual(['mortys/types.xml']);
    expect(Object.keys(store.mortys)).toEqual(['spawnabletypes.xml']);
  });

  it('drops buckets for a group that declares no spawnabletypes file', () => {
    const store = { CS: { 'types.xml': { types: [] } }, Zen: { 'custom_types.xml': { types: [] } } };
    const removed = pruneUndeclaredSpawnableFiles(store, {});

    expect(removed.sort()).toEqual(['CS/types.xml', 'Zen/custom_types.xml']);
    expect(store.CS).toEqual({});
  });

  it('keeps a declared file whatever it is called', () => {
    const store = { outland: { 'ddu_spawnable.xml': { types: [] } } };
    expect(pruneUndeclaredSpawnableFiles(store, { outland: ['db/types/outland/ddu_spawnable.xml'] })).toEqual([]);
    expect(Object.keys(store.outland)).toEqual(['ddu_spawnable.xml']);
  });

  it('keeps canonical names even when undeclared — the editor creates them before the server declares them', () => {
    const store = {
      newmod: { 'spawnabletypes.xml': { types: [] } },
      [ROOT_SPAWNABLE_GROUP]: { 'cfgspawnabletypes.xml': { types: [] }, 'cfgspawnabletype.xml': { types: [] } }
    };
    expect(pruneUndeclaredSpawnableFiles(store, {})).toEqual([]);
  });
});
