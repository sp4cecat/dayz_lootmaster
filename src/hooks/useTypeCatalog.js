import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flattenCompatibleAttachments } from '../utils/catalog.js';

/**
 * Resolve the app's own backend base URL (same rule as useLootData). The client
 * only ever talks to the 4317 backend; the upstream 8787 companion API is reached
 * server-side via /api/catalog/*.
 */
function getApiBase() {
  const savedBase = typeof window !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
  const defaultBase = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4317`
    : 'http://localhost:4317';
  return (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;
}

/**
 * @typedef {Object} TypeDetail
 * @property {string} name
 * @property {string|null} displayName
 * @property {string|null} description
 * @property {{slots:string[], itemCount:number, bySlot:Record<string,{name:string,displayName?:string|null}[]>}|null} accepts
 * @property {{slots:string[], objectCount:number, bySlot:Record<string,{name:string,displayName?:string|null}[]>}|null} fitsInto
 * @property {string[]|null} exposesSlots
 * @property {string[]|null} occupiesSlots
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
  const [catalogByName, setCatalogByName] = useState(/** @type {Map<string,{displayName:string|null}>} */(new Map()));

  // Per-name detail cache (survives across renders); a version bump nudges consumers.
  const detailCache = useRef(/** @type {Map<string, TypeDetail>} */(new Map()));
  const inflight = useRef(/** @type {Map<string, Promise<TypeDetail>>} */(new Map()));
  const [detailVersion, setDetailVersion] = useState(0);

  // Bulk load: health + summaries.
  useEffect(() => {
    let cancelled = false;
    const base = getApiBase();
    (async () => {
      try {
        const [healthRes, typesRes] = await Promise.all([
          fetch(`${base}/api/catalog/health`),
          fetch(`${base}/api/catalog/types`),
        ]);
        const health = healthRes.ok ? await healthRes.json() : null;
        const types = typesRes.ok ? await typesRes.json() : null;
        if (cancelled) return;
        setConnected(!!(health && health.modConnected));
        const map = new Map();
        for (const t of (types && Array.isArray(types.types) ? types.types : [])) {
          if (t && t.name) map.set(t.name, { displayName: t.displayName ?? null });
        }
        setCatalogByName(map);
      } catch {
        if (!cancelled) { setConnected(false); setCatalogByName(new Map()); }
      }
    })();
    return () => { cancelled = true; };
  }, [selectedProfileId]);

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
    const base = getApiBase();
    const p = (async () => {
      try {
        const res = await fetch(`${base}/api/catalog/types/${encodeURIComponent(name)}`);
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

  return useMemo(() => ({
    connected,
    catalogByName,
    displayNameFor,
    getTypeDetail,
    peekTypeDetail,
    getCompatibleAttachments,
  }), [connected, catalogByName, displayNameFor, getTypeDetail, peekTypeDetail, getCompatibleAttachments]);
}
