import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parseLimitsXml, parseTypesXml } from '../utils/xml.js';
import { loadFromStorage, saveToStorage } from '../utils/storage.js';
import { createHistory } from '../utils/history.js';
import { validateUnknowns } from '../utils/validation.js';

/**
 * @typedef {import('../utils/xml.js').Type} Type
 */

const STORAGE_KEY = 'dayz-types-editor:lootTypes';

/**
 * Hook to load limits and types, manage filters/selection, persistence, history, and unknown entries flow.
 */
export function useLootData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [definitions, setDefinitions] = useState(null);
  const [lootTypes, _setLootTypes] = useState(/** @type {Type[]|null} */(null));
  const [filters, setFilters] = useState({ category: 'all', name: '', usage: [], value: [], tag: [] });
  const [selection, setSelection] = useState(new Set());

  const historyRef = useRef(createHistory([]));

  const [unknowns, setUnknowns] = useState(makeUnknownsEmpty());

  const setLootTypes = useCallback((next, opts = { persist: false }) => {
    _setLootTypes(next);
    if (opts.persist) {
      saveToStorage(STORAGE_KEY, next);
    }
    if (definitions) {
      setUnknowns(validateUnknowns(next, definitions));
    }
  }, [definitions]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const limitsRes = await fetch('/samples/types/cfglimitsdefinition.xml');
        const limitsText = await limitsRes.text();
        const defs = parseLimitsXml(limitsText);

        let initialTypes = loadFromStorage(STORAGE_KEY);
        if (!initialTypes) {
          const typesRes = await fetch('/samples/types/types.xml');
          const typesText = await typesRes.text();
          initialTypes = parseTypesXml(typesText);
          // Initial persist
          saveToStorage(STORAGE_KEY, initialTypes);
        }

        if (!mounted) return;
        setDefinitions(defs);
        _setLootTypes(initialTypes);
        setUnknowns(validateUnknowns(initialTypes, defs));
        historyRef.current = createHistory(initialTypes);
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
      _setLootTypes(prev);
      saveToStorage(STORAGE_KEY, prev);
      if (definitions) setUnknowns(validateUnknowns(prev, definitions));
    }
  }, [definitions]);

  const redo = useCallback(() => {
    const next = historyRef.current.redo();
    if (next) {
      _setLootTypes(next);
      saveToStorage(STORAGE_KEY, next);
      if (definitions) setUnknowns(validateUnknowns(next, definitions));
    }
  }, [definitions]);

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
        setLootTypes(cleaned, { persist: true });
        pushHistory(cleaned);
      } else {
        // just persist new definitions
        if (lootTypes) {
          saveToStorage(STORAGE_KEY, lootTypes);
        }
      }
      setUnknownsOpen(false);
    }
  }), [unknownsOpen, unknowns, lootTypes, setLootTypes, pushHistory]);

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
    resolveUnknowns
  };
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
