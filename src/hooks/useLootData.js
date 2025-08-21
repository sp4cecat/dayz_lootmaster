import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseEconomyCoreXml, parseLimitsXml, parseTypesXml } from '../utils/xml.js';
import { loadFromStorage, saveToStorage } from '../utils/storage.js';
import { loadAllGrouped, saveManyTypeFiles, saveTypeFile } from '../utils/idb.js';
import { createHistory } from '../utils/history.js';
import { validateUnknowns } from '../utils/validation.js';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

/**
 * Grouped storage structure
 * @typedef {Record<string, Type[]>} TypeGroups
 */

/**
 * File-level storage structure (group -> fileBase -> types[])
 * @typedef {Record<string, Record<string, Type[]>>} TypeFiles
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

  // File-level persisted structure: group -> file -> types
  const [lootFiles, setLootFiles] = useState(/** @type {TypeFiles|null} */(null));
  // Derived grouped structure for convenience (combined per group)
  const [lootGroups, setLootGroups] = useState(/** @type {TypeGroups|null} */(null));
  // Merged array view with metadata for UI (each element augmented with "group" and source file)
  const [lootTypes, _setLootTypes] = useState(/** @type {(Type & {group: string, file: string})[]|null} */(null));
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

  // Baseline parsed from samples (read-only reference to compare against edits)
  const [baselineFiles, setBaselineFiles] = useState(/** @type {TypeFiles|null} */(null));
  const [baselineDefinitions, setBaselineDefinitions] = useState(/** @type {{categories: string[], usageflags: string[], valueflags: string[], tags: string[]}|null} */(null));


  const setFromMergedTypes = useCallback((nextMerged, opts = { persist: false }) => {
    if (!lootFiles) return;

    // Build a lookup by group+file+name -> updated type (ignore meta props on write)
    /** @type {Map<string, Type & {group?: string, file?: string}>} */
    const updatedIndex = new Map(
      nextMerged.map(t => [`${t.group}:${t.file}:${t.name}`, t])
    );

    // Rebuild file-level structure by replacing types where updated
    /** @type {TypeFiles} */
    const updatedFiles = Object.fromEntries(
      Object.entries(lootFiles).map(([group, files]) => {
        const nextFiles = Object.fromEntries(
          Object.entries(files).map(([file, arr]) => {
            const replaced = arr.map(orig => {
              const upd = updatedIndex.get(`${group}:${file}:${orig.name}`);
              if (upd) {
                const { group: _g, file: _f, ...rest } = upd;
                return { ...orig, ...rest };
              }
              return orig;
            });
            return [file, replaced];
          })
        );
        return [group, nextFiles];
      })
    );

    setLootFiles(updatedFiles);

    // Derive grouped and merged views
    const updatedGroups = combineFilesToGroups(updatedFiles);
    setLootGroups(updatedGroups);
    setDuplicatesByName(computeDuplicatesMap(updatedGroups));
    const merged = mergeFromFiles(updatedFiles);
    _setLootTypes(merged);

    // Persist per-file if requested
    if (opts.persist) {
      const records = [];
      for (const [group, files] of Object.entries(updatedFiles)) {
        for (const [file, arr] of Object.entries(files)) {
          records.push({ group, file, types: arr });
        }
      }
      void saveManyTypeFiles(records);
    }

    if (definitions) {
      setUnknowns(validateUnknowns(merged, definitions));
    }
  }, [lootFiles, definitions]);

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

        // Try file-level records from IndexedDB
        let parsedFromSamples = false;
        /** @type {TypeFiles|null} */
        let files = await loadAllGrouped();
        if (files && Object.keys(files).length === 0) files = null;

        // Fallback: legacy flat storage to seed IDB as vanilla/types
        if (!files) {
          /** @type {Type[]|null} */
          const legacy = loadFromStorage(LEGACY_STORAGE_KEY_TYPES) || null;
          if (legacy) {
            files = { vanilla: { types: legacy } };
            await saveManyTypeFiles([{ group: 'vanilla', file: 'types', types: legacy }]);
          }
        }

        // If still empty, build from samples (vanilla + cfgeconomycore order) and seed IDB per file
        if (!files) {
          /** @type {TypeFiles} */
          const assembledFiles = { };

          // 1) Vanilla base
          const vanillaRes = await fetch('/samples/db/types.xml');
          const vanillaText = await vanillaRes.text();
          const vanilla = parseTypesXml(vanillaText);
          assembledFiles.vanilla = { types: vanilla };

          // 2) Additional groups from economy core (ordered)
          try {
            const econRes = await fetch('/samples/cfgeconomycore.xml');
            const econText = await econRes.text();
            const { order, filesByGroup } = parseEconomyCoreXml(econText);

            for (const group of order) {
              const filesList = filesByGroup[group] || [];
              for (const filePath of filesList) {
                const res = await fetch(filePath);
                const text = await res.text();
                const parsed = parseTypesXml(text);

                const parts = filePath.split('/');
                const fileName = parts[parts.length - 1] || 'types.xml';
                const fileBase = fileName.replace(/\.xml$/i, '');
                if (!assembledFiles[group]) assembledFiles[group] = {};
                assembledFiles[group][fileBase] = parsed;
              }
            }
          } catch (e) {
            // If cfgeconomycore is missing or invalid, proceed with vanilla only
            // eslint-disable-next-line no-console
            console.warn('Failed to parse cfgeconomycore.xml, proceeding with vanilla only:', e);
          }

          // Persist initial build per file into IndexedDB
          const records = [];
          for (const [group, perFile] of Object.entries(assembledFiles)) {
            for (const [file, arr] of Object.entries(perFile)) {
              records.push({ group, file, types: arr });
            }
          }
          await saveManyTypeFiles(records);
          files = assembledFiles;
          parsedFromSamples = true;
        }

        if (!mounted) return;

        setDefinitions(defs);
        setBaselineDefinitions(defs);
        setLootFiles(files);

        // Derive grouped and merged views
        const groups = combineFilesToGroups(files);
        setLootGroups(groups);
        setDuplicatesByName(computeDuplicatesMap(groups));

        const merged = mergeFromFiles(files);
        _setLootTypes(merged);

        // Always parse a fresh baseline from samples for diffing
        try {
          /** @type {TypeFiles} */
          const baseline = {};
          // Vanilla
          const vanillaRes = await fetch('/samples/db/types.xml');
          const vanillaText = await vanillaRes.text();
          const vanilla = parseTypesXml(vanillaText);
          baseline.vanilla = { types: vanilla };
          // Other groups via cfgeconomycore
          try {
            const econRes = await fetch('/samples/cfgeconomycore.xml');
            const econText = await econRes.text();
            const { order, filesByGroup } = parseEconomyCoreXml(econText);
            for (const g of order) {
              const list = filesByGroup[g] || [];
              for (const filePath of list) {
                const res = await fetch(filePath);
                const text = await res.text();
                const parsed = parseTypesXml(text);
                const parts = filePath.split('/');
                const fileName = parts[parts.length - 1] || 'types.xml';
                const fileBase = fileName.replace(/\.xml$/i, '');
                if (!baseline[g]) baseline[g] = {};
                baseline[g][fileBase] = parsed;
              }
            }
          } catch (e) {
            // ignore, baseline will include vanilla only
          }
          setBaselineFiles(baseline);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('Failed to parse baseline from samples:', e);
        }
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
    if (!lootFiles) return;

    // Update files by removing the entry from all types in all files
    /** @type {TypeFiles} */
    const nextFiles = Object.fromEntries(
      Object.entries(lootFiles).map(([g, files]) => {
        const nextPerFile = Object.fromEntries(
          Object.entries(files).map(([f, arr]) => {
            const cleaned = arr.map(t => {
              const next = { ...t };
              if (kind === 'usage') next.usage = next.usage.filter(x => x !== entry);
              else if (kind === 'value') next.value = next.value.filter(x => x !== entry);
              else next.tag = next.tag.filter(x => x !== entry);
              return next;
            });
            return [f, cleaned];
          })
        );
        return [g, nextPerFile];
      })
    );

    // Persist and refresh derived state
    setLootFiles(nextFiles);
    const records = [];
    for (const [g, perFile] of Object.entries(nextFiles)) {
      for (const [f, arr] of Object.entries(perFile)) {
        records.push({ group: g, file: f, types: arr });
      }
    }
    void saveManyTypeFiles(records);

    const groups = combineFilesToGroups(nextFiles);
    setLootGroups(groups);
    const merged = mergeFromFiles(nextFiles);
    _setLootTypes(merged);
    if (definitions) setUnknowns(validateUnknowns(merged, definitions));
    historyRef.current.push(merged);

    // Update definitions to remove the entry
    setDefinitions(d => {
      if (!d) return d;
      const next =
        kind === 'usage' ? { ...d, usageflags: d.usageflags.filter(x => x !== entry) } :
        kind === 'value' ? { ...d, valueflags: d.valueflags.filter(x => x !== entry) } :
        { ...d, tags: d.tags.filter(x => x !== entry) };
      // Recompute unknowns with updated definitions
      setUnknowns(validateUnknowns(_setLootTypes ? (lootTypes || []) : [], next));
      return next;
    });
  }, [lootGroups, definitions, lootTypes]);

  /**
   * Add an entry to definitions.
   * @param {'usage'|'value'|'tag'} kind
   * @param {string} entry
   */
  const addDefinitionEntry = useCallback((kind, entry) => {
    const value = (entry || '').trim();
    if (!value) return;
    setDefinitions(d => {
      if (!d) return d;
      let next = d;
      if (kind === 'usage') {
        if (d.usageflags.includes(value)) return d;
        next = { ...d, usageflags: [...d.usageflags, value].sort() };
      } else if (kind === 'value') {
        if (d.valueflags.includes(value)) return d;
        next = { ...d, valueflags: [...d.valueflags, value].sort() };
      } else {
        if (d.tags.includes(value)) return d;
        next = { ...d, tags: [...d.tags, value].sort() };
      }
      // Recompute unknowns with updated definitions
      setUnknowns(validateUnknowns(lootTypes || [], next));
      return next;
    });
  }, [lootTypes]);

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
        // just close; definitions are already updated in state
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
    if (!lootFiles) return [];
    const keys = Object.keys(lootFiles);
    const vanillaFirst = keys.includes('vanilla') ? ['vanilla', ...keys.filter(k => k !== 'vanilla')] : keys;
    return vanillaFirst;
  }, [lootFiles]);

  /**
   * Get types array for a given group.
   * @param {string} group
   * @returns {Type[]}
   */
  const getGroupTypes = useCallback((group) => {
    if (!lootFiles || !lootFiles[group]) return [];
    /** @type {Type[]} */
    const combined = [];
    for (const arr of Object.values(lootFiles[group])) combined.push(...arr);
    return combined;
  }, [lootFiles]);

  /**
   * Get per-file breakdown for a group.
   * @param {string} group
   * @returns {{file: string, types: Type[]}[]}
   */
  const getGroupFiles = useCallback((group) => {
    if (!lootFiles || !lootFiles[group]) return [];
    return Object.entries(lootFiles[group]).map(([file, types]) => ({ file, types }));
  }, [lootFiles]);

  const storageDiff = useMemo(() => {
    /** @type {{ definitions: { categories: boolean, usageflags: boolean, valueflags: boolean, tags: boolean }, files: Record<string, Record<string, { changed: boolean, added: number, removed: number, modified: number, changedCount: number }>> }} */
    const diff = {
      definitions: { categories: false, usageflags: false, valueflags: false, tags: false },
      files: {}
    };
    // Definitions compare
    if (baselineDefinitions && definitions) {
      const cmp = (a, b) => JSON.stringify([...a].sort()) !== JSON.stringify([...b].sort());
      diff.definitions.categories = cmp(baselineDefinitions.categories, definitions.categories);
      diff.definitions.usageflags = cmp(baselineDefinitions.usageflags, definitions.usageflags);
      diff.definitions.valueflags = cmp(baselineDefinitions.valueflags, definitions.valueflags);
      diff.definitions.tags = cmp(baselineDefinitions.tags, definitions.tags);
    }
    // Files compare
    if (baselineFiles && lootFiles) {
      const allGroups = new Set([...Object.keys(baselineFiles), ...Object.keys(lootFiles)]);
      for (const g of allGroups) {
        const basePer = baselineFiles[g] || {};
        const currPer = lootFiles[g] || {};
        const allFiles = new Set([...Object.keys(basePer), ...Object.keys(currPer)]);
        for (const f of allFiles) {
          const baseArr = basePer[f] || [];
          const currArr = currPer[f] || [];
          const baseNames = new Set(baseArr.map(t => t.name));
          const currNames = new Set(currArr.map(t => t.name));
          const added = [...currNames].filter(n => !baseNames.has(n)).length;
          const removed = [...baseNames].filter(n => !currNames.has(n)).length;

          // Modified: intersection where any field differs
          const normalize = (t) => ({
            name: t.name,
            category: t.category || null,
            nominal: t.nominal, min: t.min, lifetime: t.lifetime, restock: t.restock,
            quantmin: t.quantmin, quantmax: t.quantmax,
            flags: t.flags,
            usage: [...t.usage].sort(),
            value: [...t.value].sort(),
            tag: [...t.tag].sort(),
          });
          const baseByName = new Map(baseArr.map(t => [t.name, normalize(t)]));
          const currByName = new Map(currArr.map(t => [t.name, normalize(t)]));
          let modified = 0;
          for (const name of [...baseNames].filter(n => currNames.has(n))) {
            const a = baseByName.get(name);
            const b = currByName.get(name);
            if (JSON.stringify(a) !== JSON.stringify(b)) modified++;
          }

          const changedCount = added + removed + modified;
          const changed = changedCount > 0;

          if (!diff.files[g]) diff.files[g] = {};
          diff.files[g][f] = { changed, added, removed, modified, changedCount };
        }
      }
    }
    return diff;
  }, [baselineDefinitions, definitions, baselineFiles, lootFiles]);

  const storageDirty = useMemo(() => {
    const d = storageDiff;
    if (!d) return false;
    if (d.definitions.categories || d.definitions.usageflags || d.definitions.valueflags || d.definitions.tags) return true;
    for (const g of Object.keys(d.files)) {
      for (const f of Object.keys(d.files[g])) {
        if (d.files[g][f].changed) return true;
      }
    }
    return false;
  }, [storageDiff]);

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
    getGroupTypes,
    getGroupFiles,
    duplicatesByName,
    storageDirty,
    storageDiff,
    // Summary modal
    summary: loadSummary,
    summaryOpen,
    closeSummary: () => setSummaryOpen(false),
    // Management helpers
    manage: {
      countRefs: countDefinitionRefs,
      removeEntry: removeDefinitionEntry,
      addEntry: addDefinitionEntry
    }
  };
}

/**
 * Combine file-level structure to grouped per group (concatenate files).
 * @param {TypeFiles} files
 * @returns {TypeGroups}
 */
function combineFilesToGroups(files) {
  /** @type {TypeGroups} */
  const groups = {};
  for (const [group, perFile] of Object.entries(files)) {
    groups[group] = [];
    for (const arr of Object.values(perFile)) {
      groups[group].push(...arr);
    }
  }
  return groups;
}

/**
 * Merge file-level types to a single array adding group and file metadata.
 * If multiple groups contain a type with the same name, the last group in order wins:
 * vanilla is loaded first, then additional groups (object key order).
 * @param {TypeFiles} files
 * @returns {(Type & {group: string, file: string})[]}
 */
function mergeFromFiles(files) {
  const groups = Object.keys(files);
  const orderedGroups = groups.sort((a, b) => (a === 'vanilla' ? -1 : b === 'vanilla' ? 1 : 0));

  /** @type {Map<string, Type & {group: string, file: string}>} */
  const byName = new Map();

  for (const group of orderedGroups) {
    const perFile = files[group];
    for (const [file, arr] of Object.entries(perFile)) {
      for (const t of arr) {
        byName.set(t.name, { ...t, group, file });
      }
    }
  }
  return Array.from(byName.values());
}

/**
 * Stable serialization of types for equality comparison
 * @param {Type[]} arr
 */
function serializeTypes(arr) {
  const norm = (t) => ({
    name: t.name,
    category: t.category || null,
    nominal: t.nominal, min: t.min, lifetime: t.lifetime, restock: t.restock,
    quantmin: t.quantmin, quantmax: t.quantmax,
    flags: t.flags,
    usage: [...t.usage].sort(),
    value: [...t.value].sort(),
    tag: [...t.tag].sort(),
  });
  const sorted = [...arr].sort((a, b) => a.name.localeCompare(b.name)).map(norm);
  return JSON.stringify(sorted);
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
