import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseEconomyCoreXml, parseLimitsXml, parseTypesXml } from '../utils/xml.js';
import { loadFromStorage, saveToStorage } from '../utils/storage.js';
import { createHistory } from '../utils/history.js';
import { validateUnknowns } from '../utils/validation.js';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * Grouped storage structure
 * @typedef {Record<string, Type[]>} TypeGroups
 */

const STORAGE_KEY_GROUPS = 'dayz-types-editor:lootGroups';
const LEGACY_STORAGE_KEY_TYPES = 'dayz-types-editor:lootTypes';

/**
 * Hook to load limits and grouped types, manage filters/selection, persistence, history, and unknown entries flow.
 */
export function useLootData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [definitions, setDefinitions] = useState(null);

  // Grouped types as persisted structure
  const [lootGroups, setLootGroups] = useState(/** @type {TypeGroups|null} */(null));
  // Merged array view with group metadata for UI (each element augmented with "group" prop)
  const [lootTypes, _setLootTypes] = useState(/** @type {(Type & {group: string})[]|null} */(null));
  // Filters include groups selection
  const [filters, setFilters] = useState({ category: 'all', name: '', usage: [], value: [], tag: [], groups: /** @type {string[]} */([]) });
  const [selection, setSelection] = useState(new Set());

  const historyRef = useRef(createHistory([]));

  const [unknowns, setUnknowns] = useState(makeUnknownsEmpty());

  const setFromMergedTypes = useCallback((nextMerged, opts = { persist: false }) => {
    if (!lootGroups) return;

    // Build an index from name -> updated type (ignore "group" prop on write)
    /** @type {Map<string, Type & {group?: string}>} */
    const nextByName = new Map(nextMerged.map(t => [t.name, t]));

    /** @type {TypeGroups} */
    const updatedGroups = Object.fromEntries(
      Object.entries(lootGroups).map(([group, arr]) => {
        const replaced = arr.map(t => {
          const upd = nextByName.get(t.name);
          if (upd) {
            const { group: _g, ...rest } = upd;
            return { ...t, ...rest };
          }
          return t;
        });
        return [group, replaced];
      })
    );

    setLootGroups(updatedGroups);

    const merged = mergeGroups(updatedGroups);
    _setLootTypes(merged);

    if (opts.persist) {
      saveToStorage(STORAGE_KEY_GROUPS, updatedGroups);
    }
    if (definitions) {
      setUnknowns(validateUnknowns(merged, definitions));
    }
  }, [lootGroups, definitions]);

  const setLootTypes = useCallback((next, opts = { persist: false }) => {
    // Keep backward compatibility with callers; interpret as merged array and project back to groups
    setFromMergedTypes(next, opts);
  }, [setFromMergedTypes]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Load definitions
        const limitsRes = await fetch('/samples/cfglimitsdefinition.xml');
        const limitsText = await limitsRes.text();
        const defs = parseLimitsXml(limitsText);

        // Try grouped from storage
        /** @type {TypeGroups|null} */
        let groups = loadFromStorage(STORAGE_KEY_GROUPS) || null;

        // Fallback: try legacy flat storage and wrap as vanilla
        if (!groups) {
          /** @type {Type[]|null} */
          const legacy = loadFromStorage(LEGACY_STORAGE_KEY_TYPES) || null;
          if (legacy) {
            groups = { vanilla: legacy };
          }
        }

        // If still empty, build from samples (vanilla + cfgeconomycore order)
        if (!groups) {
          // 1) Vanilla base
          const vanillaRes = await fetch('/samples/db/types.xml');
          const vanillaText = await vanillaRes.text();
          const vanilla = parseTypesXml(vanillaText);

          /** @type {TypeGroups} */
          const assembled = { vanilla };

          // 2) Additional groups from economy core (ordered)
          try {
            const econRes = await fetch('/samples/cfgeconomycore.xml');
            const econText = await econRes.text();
            const { order, filesByGroup } = parseEconomyCoreXml(econText);

            for (const group of order) {
              const files = filesByGroup[group] || [];
              /** @type {Type[]} */
              let arr = [];
              for (const filePath of files) {
                const res = await fetch(filePath);
                const text = await res.text();
                const parsed = parseTypesXml(text);
                arr = arr.concat(parsed);
              }
              assembled[group] = arr;
            }
          } catch (e) {
            // If cfgeconomycore is missing or invalid, proceed with vanilla only
            // eslint-disable-next-line no-console
            console.warn('Failed to parse cfgeconomycore.xml, proceeding with vanilla only:', e);
          }

          // Persist initial build
          saveToStorage(STORAGE_KEY_GROUPS, assembled);
          groups = assembled;
        }

        if (!mounted) return;

        setDefinitions(defs);
        setLootGroups(groups);

        const merged = mergeGroups(groups);
        _setLootTypes(merged);
        setUnknowns(validateUnknowns(merged, defs));
        historyRef.current = createHistory(merged);
        setLoading(false);
      } catch (e) {
        if (!mounted) return;
        setError(e);
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const pushHistory = useCallback((state) => {
    historyRef.current.push(state);
  }, []);

  const undo = useCallback(() => {
    const prev = historyRef.current.undo();
    if (prev) {
      setFromMergedTypes(prev, { persist: true });
    }
  }, [setFromMergedTypes]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) {
      setFromMergedTypes(next, { persist: true });
    }
  }, [setFromMergedTypes]);

  const canUndo = historyRef.current.canUndo;
  const canRedo = historyRef.current.canRedo;

  // Unknowns resolution modal control and logic
  const [unknownsOpen, setUnknownsOpen] = useState(false);
  const hasPromptedUnknownsRef = useRef(false);
  useEffect(() => {
    if (!hasPromptedUnknownsRef.current && unknowns.hasAny) {
      setUnknownsOpen(true);
      hasPromptedUnknownsRef.current = true;
    }
  }, [unknowns]);

  const resolveUnknowns = useMemo(() => ({
    isOpen: unknownsOpen,
    open: () => setUnknownsOpen(true),
    close: () => setUnknownsOpen(false),
    apply: ({ add, remove }) => {
      // Update definitions
      setDefinitions(d => {
        if (!d) return d;
        const next = {
          categories: uniq([...d.categories, ...add.category]),
          usageflags: uniq([...d.usageflags, ...add.usage]),
          valueflags: uniq([...d.valueflags, ...add.value]),
          tags: uniq([...d.tags, ...add.tag]),
        };
        // Update unknowns with new defs
        setUnknowns(validateUnknowns(lootTypes || [], next));
        return next;
      });
      // Update types if removing unknowns that remain unknown after additions
      if (remove && lootTypes) {
        // Compute which unknowns to remove (exclude those user chose to add)
        const removeUsage = new Set([...unknowns.sets.usage].filter(x => !add.usage.includes(x)));
        const removeValue = new Set([...unknowns.sets.value].filter(x => !add.value.includes(x)));
        const removeTag = new Set([...unknowns.sets.tag].filter(x => !add.tag.includes(x)));
        const removeCategory = new Set([...unknowns.sets.category].filter(x => !add.category.includes(x)));

        const cleaned = lootTypes.map(t => {
          const next = { ...t };
          if (next.category && removeCategory.has(next.category)) {
            next.category = undefined;
          }
          next.usage = next.usage.filter(u => !removeUsage.has(u));
          next.value = next.value.filter(v => !removeValue.has(v));
          next.tag = next.tag.filter(g => !removeTag.has(g));
          return next;
        });
        setFromMergedTypes(cleaned, { persist: true });
        pushHistory(cleaned);
      } else {
        // just persist definitions and current groups
        if (lootGroups) {
          saveToStorage(STORAGE_KEY_GROUPS, lootGroups);
        }
      }
      setUnknownsOpen(false);
    }
  }), [unknownsOpen, unknowns, lootTypes, setFromMergedTypes, pushHistory, lootGroups]);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo]);

  // Ordered groups list for UI: vanilla first, then the rest as defined by insertion order in object
  const groupsList = useMemo(() => {
    if (!lootGroups) return [];
    const keys = Object.keys(lootGroups);
    const vanillaFirst = keys.includes('vanilla') ? ['vanilla', ...keys.filter(k => k !== 'vanilla')] : keys;
    return vanillaFirst;
  }, [lootGroups]);

  return {
    loading,
    error,
    definitions,
    lootTypes,
    setLootTypes,
    filters,
    setFilters,
    selection,
    setSelection,
    pushHistory,
    undo,
    redo,
    canUndo: canUndo(),
    canRedo: canRedo(),
    unknowns,
    resolveUnknowns,
    groups: groupsList
  };
}

/**
 * Merge grouped types to a single array adding group metadata,
 * preserving the precedence order: vanilla first, then other groups in object order.
 * @param {TypeGroups} groups
 * @returns {(Type & {group: string})[]}
 */
function mergeGroups(groups) {
  const entries = Object.entries(groups);
  const ordered = entries.sort(([a], [b]) => (a === 'vanilla' ? -1 : b === 'vanilla' ? 1 : 0));
  /** @type {(Type & {group: string})[]} */
  const merged = [];
  for (const [group, arr] of ordered) {
    for (const t of arr) {
      merged.push({ ...t, group });
    }
  }
  return merged;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function makeUnknownsEmpty() {
  return {
    hasAny: false,
    sets: { usage: new Set(), value: new Set(), tag: new Set(), category: new Set() },
    byType: {}
  };
}
