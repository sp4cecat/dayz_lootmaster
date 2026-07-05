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

export interface TypeDetail {
  name: string;
  displayName: string | null;
  description: string | null;
  accepts: AttachmentGraph | null;
  fitsInto: AttachmentGraph | null;
  exposesSlots: string[] | null;
  occupiesSlots: string[] | null;
  cargoSize: number[] | null;
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

/**
 * Resolve the list of classes that can attach onto `parentName` (loading its detail
 * on demand). Returns null when disabled or the catalog can't answer, so callers can
 * fall back to an unrestricted picker.
 */
export function useCompatibleAttachments(parentName?: string, enabled = true): string[] | null {
  const { getTypeDetail, getCompatibleAttachments } = useCatalog();
  const [list, setList] = useState<string[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!enabled || !parentName) { setList(null); return; }
    getTypeDetail(parentName).then(() => {
      if (!cancelled) setList(getCompatibleAttachments(parentName));
    });
    return () => { cancelled = true; };
  }, [parentName, enabled, getTypeDetail, getCompatibleAttachments]);
  return list;
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
