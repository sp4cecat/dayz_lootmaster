/**
 * Airdrop Container Simulator — a faithful, dependency-free port of the runtime
 * behaviour of the DayZ-Expansion Bundle airdrop-missions mod. It lets the editor
 * preview, without deploying, what the mod will actually do:
 *
 *   1. which mission fires        — ExpansionMissionModule.FindNewMission
 *   2. which container is chosen  — ExpansionMissionEventAirdrop.Event_OnStart
 *   3. what loot ends up inside   — ExpansionLootSpawner.SpawnLoot / AddItem / Spawn
 *
 * Every stochastic function takes an injectable `rng` (default Math.random) so rolls
 * are reproducible in tests; the *odds* functions compute exact probabilities
 * analytically rather than by sampling.
 *
 * Ported from `F:\Dayz Dev\existing\@DayZ-Expansion-Bundle\addons`:
 *   - core_scripts/3_Game/DayZExpansion_Core/ExpansionStatic.c            (GetWeightedRandom)
 *   - core_scripts/4_World/DayZExpansion_Core/Systems/Loot/ExpansionLootSpawner.c
 *   - missions_scripts/4_World/.../Classes/ExpansionMissionModule.c       (mission pick)
 *   - missions_scripts/4_World/.../Classes/Airdrop/ExpansionMissionEventAirdrop.c
 */

export type Rng = () => number;

/** The slim shape used by an entry's Attachments and Variants (ExpansionLootVariant). */
export interface ExpansionLootVariant {
  Name: string;
  Chance?: number;
  Attachments?: ExpansionLootVariant[];
}

/** A top-level Loot[] entry (ExpansionLoot). */
export interface ExpansionLoot {
  Name: string;
  Chance?: number;
  Attachments?: ExpansionLootVariant[];
  QuantityPercent?: number;
  Max?: number;
  Min?: number;
  Variants?: ExpansionLootVariant[];
}

/** One AirdropSettings.json Containers[] entry (the fields the simulator needs). */
export interface SimContainer {
  Container: string;
  Usage?: number;
  Weight?: number;
  ItemCount?: number;
  Loot?: ExpansionLoot[];
  Infected?: unknown[];
}

/** The global AirdropSettings.json shape (fields the simulator needs). */
export interface SimSettings {
  ItemCount?: number;
  Containers?: SimContainer[];
}

/** A mission's on-disk data (Airdrop_*.json), fields the simulator needs. */
export interface MissionData {
  MissionName?: string;
  Weight?: number;
  Container?: string;
  ItemCount?: number;
  Enabled?: number;
  Loot?: ExpansionLoot[];
  Infected?: unknown[];
}

/** The editor's in-memory mission wrapper (matches ExpansionAirdropEditor's Mission). */
export interface MissionInput {
  file: string;
  corrupt?: boolean;
  data: MissionData;
}

// ---------------------------------------------------------------------------
// Core weighted-random primitive
// ---------------------------------------------------------------------------

/**
 * Cumulative-weight roulette — mirrors ExpansionStatic.GetWeightedRandom.
 * Returns the picked index, or -1 when every weight is 0 (the engine treats -1
 * as "nothing selected", which is how exhausted / zero-chance entries drop out).
 */
export function getWeightedRandom(weights: number[], rng: Rng = Math.random): number {
  let weightSum = 0;
  for (const w of weights) weightSum += w;
  if (weightSum === 0) return -1;

  let rnd = rng() * weightSum; // Math.RandomFloat(0, weightSum) — max exclusive
  for (let i = 0; i < weights.length; i++) {
    if (rnd < weights[i]) return i;
    rnd -= weights[i];
  }
  return -1;
}

/** Mirrors Math.RandomInt(min, max) — integer in [min, max) (max exclusive). */
export function randInt(min: number, maxExclusive: number, rng: Rng = Math.random): number {
  if (maxExclusive <= min) return min;
  return min + Math.floor(rng() * (maxExclusive - min));
}

// ---------------------------------------------------------------------------
// 1. Mission selection likelihood
// ---------------------------------------------------------------------------

export interface MissionOdds {
  file: string;
  name: string;
  weight: number;
  /** Per-selection probability (weight share) among enabled missions; 0 for disabled. */
  prob: number;
  enabled: boolean;
}

export interface MissionSelectionResult {
  rows: MissionOdds[];
  /** True when no enabled mission has weight > 0 — the engine then spawns nothing. */
  noneWillSpawn: boolean;
}

/**
 * The mod keeps one weight per mission (`m_AvailableMissions`, seeded from `Weight`)
 * and picks via GetWeightedRandom, running one mission at a time. So the relative
 * probability that a given mission is the one chosen equals its share of the total
 * weight across enabled missions. Timing (MaxMissions / TimeBetweenMissions) governs
 * how *often* a pick happens, not *which* mission wins — so it's out of scope here.
 */
export function missionSelectionOdds(missions: MissionInput[]): MissionSelectionResult {
  const enabled = missions.filter((m) => !m.corrupt && (m.data?.Enabled ?? 0) !== 0);
  const totalWeight = enabled.reduce((s, m) => s + (m.data?.Weight ?? 0), 0);

  const rows: MissionOdds[] = missions.map((m) => {
    const isEnabled = !m.corrupt && (m.data?.Enabled ?? 0) !== 0;
    const weight = m.data?.Weight ?? 0;
    return {
      file: m.file,
      name: (m.data?.MissionName || '').trim() || m.file,
      weight,
      prob: isEnabled && totalWeight > 0 ? weight / totalWeight : 0,
      enabled: isEnabled,
    };
  });

  return { rows, noneWillSpawn: totalWeight === 0 };
}

// ---------------------------------------------------------------------------
// 2. Container selection
// ---------------------------------------------------------------------------

/**
 * Candidate containers for a mission — Event_OnStart accepts Usage 0 (missions &
 * player) or 1 (missions only), matching the mission's Container name, or ALL such
 * containers when the mission's Container is "Random" (case-insensitive).
 */
export function containerCandidates(mission: MissionData, settings: SimSettings): SimContainer[] {
  const cont = String(mission?.Container ?? '').trim();
  const isRandom = cont.toLowerCase() === 'random';
  return (settings?.Containers ?? []).filter(
    (c) => (c?.Usage === 0 || c?.Usage === 1) && (isRandom || c?.Container === cont),
  );
}

export interface ContainerOdds {
  container: SimContainer;
  /** The adjusted weight actually fed to GetWeightedRandom. */
  cweight: number;
  prob: number;
}

/**
 * Adjusted container weights — Event_OnStart blends the mission's own Weight into the
 * container weights so low-weight locations tilt toward high-weight (e.g. Military)
 * crates and vice-versa:
 *
 *   weight   = (missionWeight + Σcw - maxcw) / count
 *   cweight_i = (weight - maxcw >= 0) ? weight - maxcw + cw_i : cw_i
 *
 * Probabilities are the exact cweight share. When every cweight is 0 the engine falls
 * back to GetRandomElement (uniform), which we model as 1/count.
 */
export function containerSelectionOdds(mission: MissionData, candidates: SimContainer[]): ContainerOdds[] {
  if (candidates.length === 0) return [];
  const W = mission?.Weight ?? 0;
  const weights = candidates.map((c) => c?.Weight ?? 0);
  const maxW = Math.max(...weights);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const weight = (W + sumW - maxW) / candidates.length;

  const cweights = candidates.map((_, i) => (weight - maxW >= 0 ? weight - maxW + weights[i] : weights[i]));
  const cwSum = cweights.reduce((a, b) => a + b, 0);

  return candidates.map((container, i) => ({
    container,
    cweight: cweights[i],
    prob: cwSum > 0 ? cweights[i] / cwSum : 1 / candidates.length,
  }));
}

/** Weighted pick of one candidate container (uniform fallback when all weights 0). */
export function rollContainer(mission: MissionData, candidates: SimContainer[], rng: Rng = Math.random): SimContainer | null {
  if (candidates.length === 0) return null;
  const cweights = containerSelectionOdds(mission, candidates).map((o) => o.cweight);
  const idx = getWeightedRandom(cweights, rng);
  if (idx > -1) return candidates[idx];
  // GetWeightedRandomContainer → containers.GetRandomElement() when all weights are 0.
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}

// ---------------------------------------------------------------------------
// Effective loot + ItemCount resolution
// ---------------------------------------------------------------------------

export interface ResolvedLoot {
  loot: ExpansionLoot[];
  itemCount: number;
  /** True when the loot came from the chosen container rather than the mission itself. */
  lootFromContainer: boolean;
  /** Where the resolved itemCount came from, for display. */
  itemCountSource: 'mission' | 'container' | 'settings';
}

/**
 * Resolve the loot list and ItemCount actually spawned, mirroring the inherit chain in
 * Event_OnStart: a mission uses its own Loot when non-empty, else the chosen container's
 * Loot. ItemCount inherits mission → container → global settings (each level used only
 * when > 0).
 */
export function resolveLootSource(
  mission: MissionData,
  chosenContainer: SimContainer | null,
  settings: SimSettings,
): ResolvedLoot {
  const missionLoot = mission?.Loot ?? [];
  const lootFromContainer = missionLoot.length === 0 && !!chosenContainer;
  const loot = missionLoot.length > 0 ? missionLoot : chosenContainer?.Loot ?? [];

  let itemCount: number;
  let itemCountSource: ResolvedLoot['itemCountSource'];
  if ((mission?.ItemCount ?? -1) > 0) {
    itemCount = mission!.ItemCount!;
    itemCountSource = 'mission';
  } else if (chosenContainer && (chosenContainer.ItemCount ?? -1) > 0) {
    itemCount = chosenContainer.ItemCount!;
    itemCountSource = 'container';
  } else {
    itemCount = settings?.ItemCount ?? 0;
    itemCountSource = 'settings';
  }

  return { loot, itemCount, lootFromContainer, itemCountSource };
}

// ---------------------------------------------------------------------------
// 3. Loot spawning
// ---------------------------------------------------------------------------

export interface QuantityDisplay {
  kind: 'percent' | 'default' | 'economy';
  /** Only set when kind === 'percent'. */
  percent?: number;
}

export interface SpawnedItem {
  name: string;
  quantity: QuantityDisplay;
  attachments: SpawnedItem[];
}

/**
 * The browser has no item-economy DB (GetQuantityInit / GetAmmoMax), so quantity is
 * shown symbolically rather than resolved to an absolute count.
 */
function quantityDisplay(quantityPercent: number): QuantityDisplay {
  if (quantityPercent > 0) return { kind: 'percent', percent: quantityPercent };
  if (quantityPercent === -2) return { kind: 'economy' };
  return { kind: 'default' }; // -1 (and any other sentinel) → item's default init quantity
}

/**
 * Mirrors ExpansionLootSpawner.Spawn's attachment handling: each attachment is included
 * iff |Chance| == 1 (guaranteed) OR Chance > RandomFloat(0,1), independently. Only ONE
 * level spawns — the engine passes NULL for sub-attachments, so a spawned attachment's
 * own nested Attachments never spawn.
 */
function spawnItem(name: string, quantityPercent: number, attachments: ExpansionLootVariant[], rng: Rng): SpawnedItem {
  const children: SpawnedItem[] = [];
  for (const att of attachments ?? []) {
    const c = att.Chance ?? 1;
    if (Math.abs(c) === 1.0 || c > rng()) {
      children.push({ name: att.Name, quantity: quantityDisplay(quantityPercent), attachments: [] });
    }
  }
  return { name, quantity: quantityDisplay(quantityPercent), attachments: children };
}

/**
 * Mirrors ExpansionLootSpawner.AddItem: resolve the weighted select-one over Variants
 * (with an implicit "parent" candidate), decrement the entry's remaining-uses counter,
 * then spawn. `remaining` is mutated in place (the caller tracks it across picks).
 */
function addItem(loot: ExpansionLoot, remaining: number[], index: number, rng: Rng): SpawnedItem {
  let name = loot.Name;
  let attachments = loot.Attachments ?? [];
  const variants = loot.Variants ?? [];

  if (variants.length > 0) {
    const chances = variants.map((v) => v.Chance ?? 1);
    const sum = chances.reduce((a, b) => a + b, 0);
    // Parent tail: variant chances < 1 behave as true probabilities (parent absorbs the
    // remainder); otherwise all values are relative weights and the parent gets weight 1.
    chances.push(sum < 1.0 ? 1.0 - sum : 1.0);

    const picked = getWeightedRandom(chances, rng);
    if (picked > -1 && picked < variants.length) {
      name = variants[picked].Name;
      const vatt = variants[picked].Attachments ?? [];
      if (vatt.length > 0) attachments = vatt; // a variant's attachments REPLACE the parent's
    }
  }

  if (remaining[index] > 0) remaining[index]--;

  return spawnItem(name, loot.QuantityPercent ?? -1, attachments, rng);
}

/**
 * Mirrors ExpansionLootSpawner.SpawnLoot: place exactly `itemCount` items into the crate.
 * Phase 1 force-spawns each entry's Min copies; phase 2 fills the rest via weighted
 * random over each entry's Chance-as-weight, dropping entries whose Max is exhausted.
 */
export function rollLoot(loot: ExpansionLoot[], itemCount: number, rng: Rng = Math.random): SpawnedItem[] {
  let count = itemCount;
  if (count < 0) count = randInt(1, -count, rng);

  const out: SpawnedItem[] = [];
  const chances: number[] = [];
  const remaining: number[] = loot.map((l) => l.Max ?? -1);
  let spawned = 0;

  // Phase 1 — guaranteed Min copies.
  loot.forEach((l, i) => {
    let min = l.Min ?? 0;
    while (min > 0 && spawned < count) {
      spawned++;
      min--;
      out.push(addItem(l, remaining, i, rng));
    }
    // m_RemainingChance seeded from Chance, but zeroed if the Min pass exhausted Max.
    chances.push(remaining[i] === 0 ? 0 : l.Chance ?? 1);
  });

  // Phase 2 — weighted fill.
  while (spawned < count) {
    const idx = getWeightedRandom(chances, rng);
    if (idx < 0) break; // all weights 0 → nothing left to place
    spawned++;
    out.push(addItem(loot[idx], remaining, idx, rng));
    if (remaining[idx] === 0) chances[idx] = 0; // Max reached → remove from pool
  }

  return out;
}

// ---------------------------------------------------------------------------
// Aggregate statistics
// ---------------------------------------------------------------------------

export interface LootStat {
  name: string;
  /** Percentage of rolls in which this item appeared at least once. */
  frequencyPct: number;
  /** Average number of copies across all rolls. */
  avgCount: number;
  /** Total copies summed over all rolls. */
  totalCount: number;
}

/**
 * Run `iterations` independent crate rolls and tally per top-level item: how often it
 * appears and its average count. Sorted by average count, descending.
 */
export function aggregateLoot(
  loot: ExpansionLoot[],
  itemCount: number,
  iterations: number,
  rng: Rng = Math.random,
): LootStat[] {
  const appear = new Map<string, number>();
  const total = new Map<string, number>();

  for (let r = 0; r < iterations; r++) {
    const crate = rollLoot(loot, itemCount, rng);
    const perRoll = new Map<string, number>();
    for (const item of crate) perRoll.set(item.name, (perRoll.get(item.name) ?? 0) + 1);
    for (const [name, cnt] of perRoll) {
      appear.set(name, (appear.get(name) ?? 0) + 1);
      total.set(name, (total.get(name) ?? 0) + cnt);
    }
  }

  const rows: LootStat[] = [...total.keys()].map((name) => ({
    name,
    frequencyPct: ((appear.get(name) ?? 0) / iterations) * 100,
    avgCount: (total.get(name) ?? 0) / iterations,
    totalCount: total.get(name) ?? 0,
  }));
  rows.sort((a, b) => b.avgCount - a.avgCount);
  return rows;
}
