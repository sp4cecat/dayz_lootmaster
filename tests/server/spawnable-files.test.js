import { describe, it, expect } from 'vitest';
import { isAllowedSpawnableFileName } from '../../server/spawnable-files.js';

const mortys = {
  group: 'mortys',
  declaredSpawnable: ['spawnabletypes.xml'],
  declaredTypes: ['types.xml']
};

describe('isAllowedSpawnableFileName', () => {
  it('allows a file the group declares as spawnabletypes', () => {
    expect(isAllowedSpawnableFileName({ ...mortys, fileName: 'spawnabletypes.xml' })).toBe(true);
  });

  it('allows a non-canonical name when declared as spawnabletypes', () => {
    expect(isAllowedSpawnableFileName({
      group: 'outland',
      fileName: 'ddu_spawnable.xml',
      declaredSpawnable: ['ddu_spawnable.xml'],
      declaredTypes: ['ddu_types.xml']
    })).toBe(true);
  });

  // The bug this guard exists for: a spawnabletypes PUT naming a types file used to resolve
  // to that file and overwrite it with a <spawnabletypes> document.
  it('refuses a file the group declares as types', () => {
    expect(isAllowedSpawnableFileName({ ...mortys, fileName: 'types.xml' })).toBe(false);
    expect(isAllowedSpawnableFileName({ ...mortys, fileName: 'TYPES.XML' })).toBe(false);
    expect(isAllowedSpawnableFileName({
      group: 'outland',
      fileName: 'ddu_types.xml',
      declaredSpawnable: ['spawnabletypes.xml'],
      declaredTypes: ['129_types.xml', 'ddu_types.xml']
    })).toBe(false);
  });

  it('allows the canonical name for a group that declares no spawnabletypes file yet', () => {
    expect(isAllowedSpawnableFileName({
      group: 'CS', fileName: 'spawnabletypes.xml', declaredTypes: ['types.xml']
    })).toBe(true);
  });

  it('refuses an undeclared, non-canonical name', () => {
    expect(isAllowedSpawnableFileName({
      group: 'CS', fileName: 'custom_types.xml', declaredTypes: ['types.xml']
    })).toBe(false);
  });

  it('only allows the mission-root file names for root groups', () => {
    for (const group of ['__root', 'vanilla', 'vanilla_overrides']) {
      expect(isAllowedSpawnableFileName({ group, fileName: 'cfgspawnabletypes.xml' })).toBe(true);
      expect(isAllowedSpawnableFileName({ group, fileName: 'cfgspawnabletype.xml' })).toBe(true);
      expect(isAllowedSpawnableFileName({ group, fileName: 'types.xml' })).toBe(false);
      expect(isAllowedSpawnableFileName({ group, fileName: 'cfgeconomycore.xml' })).toBe(false);
    }
  });

  it('refuses names that could escape the group folder', () => {
    expect(isAllowedSpawnableFileName({ ...mortys, fileName: '..' })).toBe(false);
    expect(isAllowedSpawnableFileName({ ...mortys, fileName: '../types.xml' })).toBe(false);
    expect(isAllowedSpawnableFileName({ ...mortys, fileName: '' })).toBe(false);
    expect(isAllowedSpawnableFileName({ ...mortys, fileName: null })).toBe(false);
  });
});
