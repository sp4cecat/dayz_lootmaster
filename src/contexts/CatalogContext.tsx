import React, { createContext, useContext, useEffect, useState } from 'react';
import { useTypeCatalog } from '../hooks/useTypeCatalog.js';

export interface AttachmentRef {
  name: string;
  displayName?: string | null;
}

export interface AttachmentGraph {
  slots: string[];
  itemCount?: number;
  objectCount?: number;
  bySlot: Record<string, AttachmentRef[]>;
}

/** One DamageSystem GlobalArmor row: how much a given damage-type deals to each zone
 *  (0 = immune/full protection, higher = less protection, -1 = zone not declared). */
export interface ArmorEntry {
  /** cfgAmmo/damage-type class (e.g. Bullet_762x39, FragGrenade, MeleeFist). */
  ammo: string;
  /** Health-zone damage coefficient; -1 if not declared. */
  health: number;
  /** Blood-zone damage coefficient; -1 if not declared. */
  blood: number;
  /** Shock-zone damage coefficient; -1 if not declared. */
  shock: number;
}

export interface TypeDetail {
  name: string;
  displayName: string | null;
  description: string | null;
  accepts: AttachmentGraph | null;
  fitsInto: AttachmentGraph | null;
  exposesSlots: string[] | null;
  occupiesSlots: string[] | null;
  cargoSize: number[] | null;
  /** Compatible magazine classes (CfgWeapons magazines[]); null/empty for non-weapons. */
  magazines: string[] | null;
  /** Base durability (DamageSystem GlobalHealth Health hitpoints); 0/null if none. */
  hitpoints: number | null;
  /** DamageSystem GlobalArmor rows, one per declared damage-type; null when unknown. */
  armor: ArmorEntry[] | null;
}

export interface CatalogValue {
  /** True when the companion mod is connected (metadata is live). */
  connected: boolean;
  catalogByName: Map<string, { displayName: string | null }>;
  /** Synchronous displayName lookup; undefined when unknown. */
  displayNameFor: (name?: string) => string | undefined;
  /** Async normalized detail for one class (cached); null on failure. */
  getTypeDetail: (name: string) => Promise<TypeDetail | null>;
  /** Read a detail already in cache without fetching; undefined if not loaded. */
  peekTypeDetail: (name?: string) => TypeDetail | undefined;
  /** Class names that can attach ONTO parentName; null when catalog can't answer. */
  getCompatibleAttachments: (parentName?: string) => string[] | null;
}

const noopCatalog: CatalogValue = {
  connected: false,
  catalogByName: new Map(),
  displayNameFor: () => undefined,
  getTypeDetail: async () => null,
  peekTypeDetail: () => undefined,
  getCompatibleAttachments: () => null,
};

const CatalogContext = createContext<CatalogValue>(noopCatalog);

export function CatalogProvider({
  selectedProfileId,
  children,
}: {
  selectedProfileId?: string;
  children: React.ReactNode;
}) {
  const value = useTypeCatalog(selectedProfileId) as CatalogValue;
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

/** Access the companion-mod catalog. Safe outside a provider (returns a no-op catalog). */
export function useCatalog(): CatalogValue {
  return useContext(CatalogContext);
}

/** Case-insensitive lookup into an AttachmentGraph's bySlot map (server slot keys can
 *  differ in case from the raw attachments[] casing). Exported for testing. */
export function bySlotCaseInsensitive(graph: AttachmentGraph | null | undefined, slot: string): AttachmentRef[] | null {
  if (!graph?.bySlot) return null;
  const direct = graph.bySlot[slot];
  if (direct) return direct;
  const target = slot.toLowerCase();
  for (const key of Object.keys(graph.bySlot)) {
    if (key.toLowerCase() === target) return graph.bySlot[key];
  }
  return null;
}

/** Synthetic linked-slot name for a group of magazines. Magazines are not a real attachment
 *  slot in the catalog's `accepts` graph — they live in the parent's compatible-magazine list
 *  (CfgWeapons magazines[]) — but we treat them as one linked slot for grouping so magazine
 *  groups can be linked and their member picker restricted to compatible magazines. */
export const MAGAZINE_SLOT = 'magazines';

/** Choose the linked slot that best fits a group's member class names. Candidates are the
 *  exposed slots on `accepts` plus a synthetic `MAGAZINE_SLOT` backed by `magazines` (the
 *  parent's compatible-magazine classes). Returns the slot name, or null when nothing fits.
 *  Prefers the slot covering the most members; ties broken toward the most specific slot
 *  (fewest fitting items). Comparison is case-insensitive (server slot/item casing varies). */
export function inferGroupSlot(
  accepts: AttachmentGraph | null | undefined,
  memberNames: string[],
  magazines?: string[] | null,
): string | null {
  const members = memberNames.map(n => n?.toLowerCase()).filter(Boolean);
  if (!members.length) return null;
  // Candidate slots: every exposed slot plus, when present, the synthetic magazines slot.
  const candidates: Array<[string, string[]]> = [];
  if (accepts?.bySlot) {
    for (const [slot, refs] of Object.entries(accepts.bySlot)) candidates.push([slot, refs.map(r => r.name)]);
  }
  if (magazines?.length) candidates.push([MAGAZINE_SLOT, magazines]);
  let best: { slot: string; matched: number; size: number } | null = null;
  for (const [slot, refs] of candidates) {
    const fitting = new Set(refs.map(r => r.toLowerCase()));
    const matched = members.filter(m => fitting.has(m)).length;
    if (matched === 0) continue;
    if (!best || matched > best.matched || (matched === best.matched && fitting.size < best.size)) {
      best = { slot, matched, size: fitting.size };
    }
  }
  return best ? best.slot : null;
}

/**
 * Resolve the list of classes that can attach onto `parentName` (loading its detail
 * on demand). Returns null when disabled or the catalog can't answer, so callers can
 * fall back to an unrestricted picker.
 *
 * When `slot` is given, the list is narrowed to the items that fit that specific exposed
 * slot (`accepts.bySlot[slot]`) instead of the flattened set — used to restrict a group's
 * member picker to its linked slot.
 */
export function useCompatibleAttachments(parentName?: string, enabled = true, slot?: string): string[] | null {
  const { getTypeDetail, getCompatibleAttachments, peekTypeDetail } = useCatalog();
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !parentName) { setList(null); return; }
    getTypeDetail(parentName).then(() => {
      if (cancelled) return;
      if (slot === MAGAZINE_SLOT) {
        // Magazine group: restrict to the parent's compatible magazines (not an accepts slot).
        setList(peekTypeDetail(parentName)?.magazines ?? null);
      } else if (slot) {
        const refs = bySlotCaseInsensitive(peekTypeDetail(parentName)?.accepts, slot);
        setList(refs ? refs.map(r => r.name) : null);
      } else {
        setList(getCompatibleAttachments(parentName));
      }
    });
    return () => { cancelled = true; };
  }, [parentName, enabled, slot, getTypeDetail, getCompatibleAttachments, peekTypeDetail]);
  return list;
}

/**
 * Resolve the attachment-slot graph a class exposes (`accepts`), loading its detail on
 * demand. Returns null when disabled or the catalog can't answer. Used to populate the
 * slot picker when creating / editing an attachment group.
 */
export function useAttachmentSlots(name?: string, enabled = true): AttachmentGraph | null {
  const { getTypeDetail, peekTypeDetail } = useCatalog();
  const [graph, setGraph] = useState<AttachmentGraph | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !name) { setGraph(null); return; }
    getTypeDetail(name).then(() => {
      if (!cancelled) setGraph(peekTypeDetail(name)?.accepts ?? null);
    });
    return () => { cancelled = true; };
  }, [name, enabled, getTypeDetail, peekTypeDetail]);
  return graph;
}

/**
 * Resolve the compatible-magazine class list for `name` (CfgWeapons magazines[]), loading its
 * detail on demand. Returns null when disabled or the catalog can't answer. Used to offer the
 * synthetic MAGAZINE_SLOT as a linked-slot option for a magazine group.
 */
export function useMagazines(name?: string, enabled = true): string[] | null {
  const { getTypeDetail, peekTypeDetail } = useCatalog();
  const [mags, setMags] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !name) { setMags(null); return; }
    getTypeDetail(name).then(() => {
      if (!cancelled) setMags(peekTypeDetail(name)?.magazines ?? null);
    });
    return () => { cancelled = true; };
  }, [name, enabled, getTypeDetail, peekTypeDetail]);
  return mags;
}

export interface ItemCapabilities {
  /** true = exposes attachment slots; false = exposes none; null = catalog can't answer. */
  acceptsAttachments: boolean | null;
  /** true = has cargo capacity; false = not a container; null = catalog can't answer. */
  holdsCargo: boolean | null;
}

/**
 * Resolve whether `name` can take attachments and/or hold cargo, loading its detail on
 * demand. Each capability is null when the catalog can't answer (disabled, disconnected,
 * unknown, or not yet loaded), so callers keep offering the option in that case
 * (the `null = unknown → don't hide` convention).
 *
 * Unlike useCompatibleAttachments (which restricts the item picker), this hook only
 * decides whether the attachment/cargo *sections* are offered at all.
 */
export function useItemCapabilities(name?: string, enabled = true): ItemCapabilities {
  const { getTypeDetail, peekTypeDetail } = useCatalog();
  const [caps, setCaps] = useState<ItemCapabilities>({ acceptsAttachments: null, holdsCargo: null });
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !name) { setCaps({ acceptsAttachments: null, holdsCargo: null }); return; }
    getTypeDetail(name).then(() => {
      if (cancelled) return;
      const detail = peekTypeDetail(name);
      setCaps(deriveItemCapabilities(detail));
    });
    return () => { cancelled = true; };
  }, [name, enabled, getTypeDetail, peekTypeDetail]);
  return caps;
}

/** Pure capability derivation from a (possibly missing) TypeDetail. Exported for reuse. */
export function deriveItemCapabilities(detail?: TypeDetail): ItemCapabilities {
  if (!detail) return { acceptsAttachments: null, holdsCargo: null };
  // exposesSlots is the item's own attachments[] — the direct answer to "can anything attach?".
  const exposes = detail.exposesSlots;
  const acceptsAttachments = Array.isArray(exposes) ? exposes.length > 0 : null;
  // cargoSize is [rows, cols]; a positive product means real container capacity.
  const cargo = detail.cargoSize;
  const holdsCargo = Array.isArray(cargo)
    ? cargo.length > 0 && cargo.reduce((a, b) => a * (Number(b) || 0), 1) > 0
    : null;
  return { acceptsAttachments, holdsCargo };
}
