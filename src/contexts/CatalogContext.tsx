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
