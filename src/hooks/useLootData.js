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
const STORAGE_KEY_SUMMARY_SHOWN = 'dayz-types-editor:summaryShown';

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

  /**
   * Summary data computed after initial load.
   * Contains counts of types and definition entries, plus optional group breakdown.
   * @type {[{typesTotal: number, definitions: {categories: number, usageflags: number, valueflags: number, tags: number}, groups?: { name: string, count: number }[] } | null, (next: any) => void]}
   */
  const [loadSummary, setLoadSummary] = useState(/** @type {{typesTotal: number, definitions: {categories: number, usageflags: number, valueflags: number, tags: number}, groups?: { name: string, count: number }[] }|null} */(null));
  const [summaryOpen, setSummaryOpen] = useState(false);

  // Map type name -> array of groups the type appears in
  const [duplicatesByName, setDuplicatesByName] = useState(/** @type {Record<string, string[]>} */({}));


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
    // Update duplicates map after applying changes
    setDuplicatesByName(computeDuplicatesMap(updatedGroups));

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
        let parsedFromSamples = false;
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

            console.log(econText,  order, filesByGroup)

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
          parsedFromSamples = true;
        }

        if (!mounted) return;

        setDefinitions(defs);
        setLootGroups(groups);
        setDuplicatesByName(computeDuplicatesMap(groups));

        const merged = mergeGroups(groups);
        _setLootTypes(merged);
        setUnknowns(validateUnknowns(merged, defs));
        historyRef.current = createHistory(merged);

        // Prepare and show one-time summary of loaded data (only on first parse-and-load)
        const groupOrder = Object.keys(groups).sort((a, b) => (a === 'vanilla' ? -1 : b === 'vanilla' ? 1 : 0));
        const summaryPayload = {
          typesTotal: merged.length,
          definitions: {
            categories: defs.categories.length,
            usageflags: defs.usageflags.length,
            valueflags: defs.valueflags.length,
            tags: defs.tags.length,
          },
          groups: groupOrder.map(name => ({ name, count: (groups[name] || []).length }))
        };
        const alreadyShown = !!loadFromStorage(STORAGE_KEY_SUMMARY_SHOWN);
        if (parsedFromSamples && !alreadyShown) {
          setLoadSummary(summaryPayload);
          setSummaryOpen(true);
          saveToStorage(STORAGE_KEY_SUMMARY_SHOWN, true);
        }

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

  /**
   * Count how many types reference a given entry by kind.
   * @param {'usage'|'value'|'tag'} kind
   * @param {string} entry
   * @returns {number}
   */
  const countDefinitionRefs = useCallback((kind, entry) => {
    const arr = lootTypes || [];
    if (kind === 'usage') return arr.filter(t => t.usage.includes(entry)).length;
    if (kind === 'value') return arr.filter(t => t.value.includes(entry)).length;
    return arr.filter(t => t.tag.includes(entry)).length;
  }, [lootTypes]);

  /**
   * Remove an entry from definitions and from all types; persist and push history.
   * @param {'usage'|'value'|'tag'} kind
   * @param {string} entry
   */
  const removeDefinitionEntry = useCallback((kind, entry) => {
    if (!lootGroups) return;

    // Update groups by removing the entry from all types in all groups
    /** @type {TypeGroups} */
    const nextGroups = Object.fromEntries(
      Object.entries(lootGroups).map(([g, arr]) => {
        const cleaned = arr.map(t => {
          const next = { ...t };
          if (kind === 'usage') next.usage = next.usage.filter(x => x !== entry);
          else if (kind === 'value') next.value = next.value.filter(x => x !== entry);
          else next.tag = next.tag.filter(x => x !== entry);
          return next;
        });
        return [g, cleaned];
      })
    );

    // Persist and refresh derived state
    setLootGroups(nextGroups);
    saveToStorage(STORAGE_KEY_GROUPS, nextGroups);
    const merged = mergeGroups(nextGroups);
    _setLootTypes(merged);
    if (definitions) setUnknowns(validateUnknowns(merged, definitions));
    historyRef.current.push(merged);

    // Update definitions to remove the entry
    setDefinitions(d => {
      if (!d) return d;
      if (kind === 'usage') return { ...d, usageflags: d.usageflags.filter(x => x !== entry) };
      if (kind === 'value') return { ...d, valueflags: d.valueflags.filter(x => x !== entry) };
      return { ...d, tags: d.tags.filter(x => x !== entry) };
    });
  }, [lootGroups, definitions]);

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
    groups: groupsList,
    duplicatesByName,
    // Summary modal
    summary: loadSummary,
    summaryOpen,
    closeSummary: () => setSummaryOpen(false),
    // Management helpers
    manage: {
      countRefs: countDefinitionRefs,
      removeEntry: removeDefinitionEntry
    }
  };
}

/**
 * Merge grouped types to a single array adding group metadata.
 * If multiple groups contain a type with the same name, the last loaded one wins:
 * vanilla is loaded first, then additional groups in order from cfgeconomycore.
 * @param {TypeGroups} groups
 * @returns {(Type & {group: string})[]}
 */
function mergeGroups(groups) {
  const entries = Object.entries(groups);
  const ordered = entries.sort(([a], [b]) => (a === 'vanilla' ? -1 : b === 'vanilla' ? 1 : 0));

  // Use a map to ensure last definition for a given name is kept
  /** @type {Map<string, Type & {group: string}>} */
  const byName = new Map();

  for (const [group, arr] of ordered) {
    for (const t of arr) {
      // Later groups overwrite earlier ones
      byName.set(t.name, { ...t, group });
    }
  }

  // Note: Map preserves insertion order; sorting UI will handle user-facing order
  return Array.from(byName.values());
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

/**
 * Compute duplicates map: type name -> list of groups the type appears in.
 * @param {TypeGroups} groups
 * @returns {Record<string, string[]>}
 */
function computeDuplicatesMap(groups) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map();
  for (const [group, arr] of Object.entries(groups)) {
    for (const t of arr) {
      if (!map.has(t.name)) map.set(t.name, new Set());
      map.get(t.name).add(group);
    }
  }
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [name, set] of map.entries()) {
    out[name] = Array.from(set);
  }
  return out;
}
