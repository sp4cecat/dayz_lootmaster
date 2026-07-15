import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenCompatibleAttachments } from '../utils/catalog.js';
import { apiFetch } from '../utils/api';

/**
 * @typedef {Object} TypeDetail
 * @property {string} name
 * @property {string|null} displayName
 * @property {string|null} description
 * @property {{slots:string[], itemCount:number, bySlot:Record<string,{name:string,displayName?:string|null}[]>}|null} accepts
 * @property {{slots:string[], objectCount:number, bySlot:Record<string,{name:string,displayName?:string|null}[]>}|null} fitsInto
 * @property {string[]|null} exposesSlots
 * @property {string[]|null} occupiesSlots
 * @property {number[]|null} cargoSize
 * @property {boolean|null} isContainer
 * @property {string[]|null} magazines
 * @property {number|null} hitpoints
 * @property {{ammo:string,health:number,blood:number,shock:number}[]|null} armor
 */

/**
 * Loads companion-mod catalog metadata (displayName/description + attachment graph)
 * from the app backend's /api/catalog/* proxy. Everything degrades gracefully: when
 * the mod is not connected, connected is false and lookups return empty/null so callers
 * fall back to raw class names and unrestricted pickers.
 *
 * @param {string} [selectedProfileId] - re-fetch the bulk summaries when the profile changes.
 */
export function useTypeCatalog(selectedProfileId) {
  const [connected, setConnected] = useState(false);
  // ms epoch of the mod's last live snapshot push (heartbeat); 0 when never synced.
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [catalogByName, setCatalogByName] = useState(/** @type {Map<string,{displayName:string|null}>} */(new Map()));
  // Occupiable attachment-slot vocabulary (union of items' inventorySlot[]); [] when unknown.
  const [slotVocabulary, setSlotVocabulary] = useState(/** @type {{slot:string,count:number}[]} */([]));

  // Per-name detail cache (survives across renders); a version bump nudges consumers.
  const detailCache = useRef(/** @type {Map<string, TypeDetail>} */(new Map()));
  const inflight = useRef(/** @type {Map<string, Promise<TypeDetail>>} */(new Map()));
  const [detailVersion, setDetailVersion] = useState(0);
  // Per-slot "items that occupy this slot" cache (keyed lowercase), survives across renders.
  const slotItemsCache = useRef(/** @type {Map<string, string[]>} */(new Map()));
  const slotInflight = useRef(/** @type {Map<string, Promise<string[]>>} */(new Map()));

  // ms epoch of the catalog import the caches were populated against. When the mod re-imports
  // (e.g. reconnects after being offline), catalogAt changes and we must drop the per-name and
  // per-slot caches — otherwise stale details fetched while disconnected (e.g. all-null, so no
  // occupiesSlots) are served forever. The health poll bumps reloadTick when it sees a new one.
  const catalogAtRef = useRef(0);
  const [reloadTick, setReloadTick] = useState(0);

  // Bulk load: health + summaries. Re-runs on profile change and whenever a fresh catalog import
  // is detected (reloadTick), clearing the detail/slot caches so stale entries don't survive.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [healthRes, typesRes, slotsRes] = await Promise.all([
          apiFetch('/api/catalog/health'),
          apiFetch('/api/catalog/types'),
          apiFetch('/api/catalog/slots'),
        ]);
        const health = healthRes.ok ? await healthRes.json() : null;
        const types = typesRes.ok ? await typesRes.json() : null;
        const slots = slotsRes.ok ? await slotsRes.json() : null;
        if (cancelled) return;
        setConnected(!!(health && health.modConnected));
        setLastSyncAt(health?.snapshotAt || 0);
        catalogAtRef.current = health?.catalogAt || 0;
        const map = new Map();
        for (const t of (types && Array.isArray(types.types) ? types.types : [])) {
          if (t && t.name) map.set(t.name, { displayName: t.displayName ?? null });
        }
        setCatalogByName(map);
        // Per-name details and per-slot item lists change with the catalog; drop the stale caches
        // on (re)load and nudge consumers (detailVersion) so they refetch against fresh data.
        detailCache.current.clear();
        inflight.current.clear();
        slotItemsCache.current.clear();
        slotInflight.current.clear();
        setDetailVersion(v => v + 1);
        setSlotVocabulary(slots && Array.isArray(slots.slots) ? slots.slots : []);
      } catch {
        if (!cancelled) { setConnected(false); setCatalogByName(new Map()); setSlotVocabulary([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProfileId, reloadTick]);

  // Lightweight health poll: keeps connected + lastSyncAt current (and flips the
  // sync indicator to stale when the mod stops pushing) without refetching the
  // full type list. Also detects a fresh catalog import (catalogAt change) and triggers
  // a bulk reload so caches populated against an older/empty catalog are dropped.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await apiFetch('/api/catalog/health');
        const health = res.ok ? await res.json() : null;
        if (cancelled) return;
        setConnected(!!(health && health.modConnected));
        setLastSyncAt(health?.snapshotAt || 0);
        const at = health?.catalogAt || 0;
        if (at && at !== catalogAtRef.current) {
          catalogAtRef.current = at;
          setReloadTick(t => t + 1);
        }
      } catch {
        if (!cancelled) setConnected(false);
      }
    };
    const id = setInterval(poll, 10000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  /** Synchronous displayName lookup; undefined when unknown. */
  const displayNameFor = useCallback((name) => {
    if (!name) return undefined;
    const hit = catalogByName.get(name);
    if (hit && hit.displayName) return hit.displayName;
    const cached = detailCache.current.get(name);
    return cached && cached.displayName ? cached.displayName : undefined;
  }, [catalogByName]);

  /** Async normalized detail for one class, cached. Returns null on failure. */
  const getTypeDetail = useCallback(async (name) => {
    if (!name) return null;
    if (detailCache.current.has(name)) return detailCache.current.get(name);
    if (inflight.current.has(name)) return inflight.current.get(name);
    const p = (async () => {
      try {
        const res = await apiFetch(`/api/catalog/types/${encodeURIComponent(name)}`);
        const detail = res.ok ? await res.json() : null;
        if (detail) {
          detailCache.current.set(name, detail);
          setDetailVersion(v => v + 1);
        }
        return detail;
      } catch {
        return null;
      } finally {
        inflight.current.delete(name);
      }
    })();
    inflight.current.set(name, p);
    return p;
  }, []);

  /** Read a detail already in cache without triggering a fetch (undefined if not loaded). */
  const peekTypeDetail = useCallback((name) => (name ? detailCache.current.get(name) : undefined), [detailVersion]);

  /**
   * De-duped list of class names that can attach ONTO parentName (flattened accepts.bySlot).
   * Returns null when the catalog can't answer (disconnected, unknown, or not yet loaded)
   * so callers can fall back to "no restriction".
   */
  const getCompatibleAttachments = useCallback((parentName) => {
    if (!parentName) return null;
    const detail = detailCache.current.get(parentName);
    if (!detail) return null; // not loaded yet -> caller should fetch via getTypeDetail
    return flattenCompatibleAttachments(detail);
  }, [detailVersion]);

  /**
   * Async list of class names that occupy a given attachment slot (case-insensitive), cached.
   * Returns [] when the catalog can't answer (disconnected/unknown) so callers can decide to
   * fall back to an unrestricted picker.
   */
  const getItemsForSlot = useCallback(async (slot) => {
    if (!slot) return [];
    const key = String(slot).toLowerCase();
    if (slotItemsCache.current.has(key)) return slotItemsCache.current.get(key);
    if (slotInflight.current.has(key)) return slotInflight.current.get(key);
    const p = (async () => {
      try {
        const res = await apiFetch(`/api/catalog/slots/${encodeURIComponent(slot)}`);
        const data = res.ok ? await res.json() : null;
        const names = data && Array.isArray(data.items) ? data.items.map(i => i.name).filter(Boolean) : [];
        slotItemsCache.current.set(key, names);
        return names;
      } catch {
        return [];
      } finally {
        slotInflight.current.delete(key);
      }
    })();
    slotInflight.current.set(key, p);
    return p;
  }, []);

  return useMemo(() => ({
    connected,
    lastSyncAt,
    catalogByName,
    slotVocabulary,
    displayNameFor,
    getTypeDetail,
    peekTypeDetail,
    getCompatibleAttachments,
    getItemsForSlot,
  }), [connected, lastSyncAt, catalogByName, slotVocabulary, displayNameFor, getTypeDetail, peekTypeDetail, getCompatibleAttachments, getItemsForSlot]);
}
