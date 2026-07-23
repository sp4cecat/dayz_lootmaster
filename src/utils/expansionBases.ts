import type { DropLocation } from '@/components/AirdropDropLocationMap';

/**
 * Pure helpers for the Bases & Territories editor: the Expansion TerritorySettings.json and
 * BaseBuildingSettings.json files are edited as whole objects (so m_Version and any fields the UI
 * doesn't surface ride along untouched), and the build-zone map reuses the airdrop DropLocation
 * shape via the Center[x,0,z] <-> {x,z} adapters below.
 */

/** Current Expansion schema versions (from the mod's real example files). */
export const TERRITORY_VERSION = 6;
export const BASEBUILDING_VERSION = 5;

/** A single BaseBuilding build zone. Center is world [x, y, z]; y is always 0 (ground plane). */
export interface BuildZone {
  Name: string;
  Center: [number, number, number];
  Radius: number;
  Items: string[];
  IsWhitelist: number;
  CustomMessage: string;
  [key: string]: any;
}

/** Seed used when TerritorySettings.json doesn't exist yet (first save creates it). */
export const DEFAULT_TERRITORY: Record<string, any> = {
  m_Version: TERRITORY_VERSION,
  EnableTerritories: 1,
  UseWholeMapForInviteList: 0,
  TerritorySize: 60.0,
  TerritoryPerimeterSize: 120.0,
  MaxMembersInTerritory: 10,
  MaxTerritoryPerPlayer: 2,
  TerritoryInviteAcceptRadius: 2.0,
  AuthenticateCodeLockIfTerritoryMember: 0,
  InviteCooldown: 0,
  OnlyInviteGroupMember: 0,
  MaxCodeLocksOnBBPerTerritory: -1,
  MaxCodeLocksOnItemsPerTerritory: -1,
};

/** Seed used when BaseBuildingSettings.json doesn't exist yet (first save creates it). */
export const DEFAULT_BASEBUILDING: Record<string, any> = {
  m_Version: BASEBUILDING_VERSION,
  CanBuildAnywhere: 0,
  AllowBuildingWithoutATerritory: 1,
  DeployableOutsideATerritory: [],
  DeployableInsideAEnemyTerritory: [],
  CanCraftVanillaBasebuilding: 1,
  CanCraftExpansionBasebuilding: 0,
  DestroyFlagOnDismantle: 0,
  DismantleOutsideTerritory: 1,
  DismantleInsideTerritory: 1,
  DismantleFlagMode: -1,
  DismantleAnywhere: 0,
  CodelockActionsAnywhere: 1,
  CodeLockLength: 6,
  DoDamageWhenEnterWrongCodeLock: 1,
  DamageWhenEnterWrongCodeLock: 10,
  RememberCode: 1,
  CanCraftTerritoryFlagKit: 1,
  SimpleTerritory: 0,
  AutomaticFlagOnCreation: 0,
  GetTerritoryFlagKitAfterBuild: 1,
  BuildZoneRequiredCustomMessage: 'This is a No Build Zone',
  Zones: [],
  ZonesAreNoBuildZones: 1,
  CodelockAttachMode: 1,
  FlagMenuMode: 2,
  PreventItemAccessThroughObstructingItems: 1,
  EnableVirtualStorage: 0,
  VirtualStorageExcludedContainers: [],
};

/**
 * Stamp `m_Version` onto a settings object for save, preserving any existing version (so a file
 * authored at a newer version isn't silently downgraded) and defaulting when absent. Returns a new
 * object; every other field (including ones the UI never surfaced) is carried through unchanged.
 */
export function stampVersion<T extends Record<string, any>>(obj: T, version: number): T {
  const existing = obj?.m_Version;
  const m_Version = typeof existing === 'number' && existing > 0 ? existing : version;
  return { ...obj, m_Version };
}

/** Map a build zone onto the airdrop map's DropLocation shape (Center[0]=x, Center[2]=z). */
export function zoneToDrop(zone: BuildZone): DropLocation {
  const center = Array.isArray(zone?.Center) ? zone.Center : [0, 0, 0];
  return { Name: zone?.Name, x: center[0] ?? 0, z: center[2] ?? 0, Radius: zone?.Radius };
}

/**
 * Fold a map-edited DropLocation back onto its zone, preserving every non-geometry field
 * (Items/IsWhitelist/CustomMessage and any unknown keys). Coordinates are rounded to whole meters.
 */
export function applyDropToZone(zone: BuildZone, drop: DropLocation): BuildZone {
  return {
    ...zone,
    Name: drop.Name ?? zone.Name,
    Center: [Math.round(drop.x), 0, Math.round(drop.z)],
    Radius: drop.Radius != null ? Math.round(drop.Radius) : zone.Radius,
  };
}
