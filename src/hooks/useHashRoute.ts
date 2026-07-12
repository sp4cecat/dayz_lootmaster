import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { NAV_ITEMS, NavItem } from '@/consts/navigation';

// The set of navigable "view" ids. `view` is a colon-delimited hierarchical id
// (e.g. 'addons:expansion:airdrops') that maps 1:1 onto the URL hash path
// (e.g. '#/addons/expansion/airdrops'). Only leaf nav items are real screens.
function collectLeafIds(items: NavItem[], prefix = ''): string[] {
  const ids: string[] = [];
  for (const item of items) {
    const fullId = prefix ? `${prefix}:${item.id}` : item.id;
    if (item.subItems && item.subItems.length > 0) {
      ids.push(...collectLeafIds(item.subItems, fullId));
    } else {
      ids.push(fullId);
    }
  }
  return ids;
}

// 'profiles' is a valid screen but lives outside NAV_ITEMS (it is reached via the
// profile button, not the sidebar tree).
const VALID_VIEWS = new Set<string>([...collectLeafIds(NAV_ITEMS), 'profiles']);

const DEFAULT_VIEW = 'cle';

interface ParsedHash {
  view: string;
  params: URLSearchParams;
}

function parseHash(hash: string): ParsedHash {
  // Strip leading '#' and an optional leading '/'.
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart = ''] = raw.split('?');
  const view = pathPart.split('/').filter(Boolean).join(':');
  const params = new URLSearchParams(queryPart);
  if (!view || !VALID_VIEWS.has(view)) {
    return { view: DEFAULT_VIEW, params };
  }
  return { view, params };
}

function buildHash(view: string, params?: URLSearchParams): string {
  const path = view.split(':').join('/');
  const qs = params ? params.toString() : '';
  return `/${path}${qs ? `?${qs}` : ''}`;
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  window.addEventListener('popstate', callback);
  return () => {
    window.removeEventListener('hashchange', callback);
    window.removeEventListener('popstate', callback);
  };
}

const getSnapshot = () => window.location.hash;
const getServerSnapshot = () => '';

export interface HashRoute {
  /** Current view id, e.g. 'cle' or 'addons:expansion:airdrops'. */
  view: string;
  /** Read a query param from the current hash (e.g. the active sub-tab). */
  getParam: (key: string) => string | null;
  /** Navigate to a view, replacing the whole hash (drops existing query params). Pushes a history entry. */
  navigate: (view: string, params?: Record<string, string>) => void;
  /** Update a single query param on the current view without adding a history entry. */
  setParam: (key: string, value: string | null) => void;
}

export function useHashRoute(): HashRoute {
  const hash = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { view, params } = useMemo(() => parseHash(hash), [hash]);

  const getParam = useCallback((key: string) => params.get(key), [params]);

  const navigate = useCallback((nextView: string, nextParams?: Record<string, string>) => {
    const search = nextParams ? new URLSearchParams(nextParams) : undefined;
    // Assigning location.hash pushes a history entry and fires 'hashchange'.
    window.location.hash = buildHash(nextView, search);
  }, []);

  const setParam = useCallback((key: string, value: string | null) => {
    // Re-parse live so we preserve the current view even if this consumer's
    // memoized snapshot is momentarily stale.
    const current = parseHash(window.location.hash);
    const next = new URLSearchParams(current.params);
    if (value === null) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // Use replaceState so switching sub-tabs does not pollute back/forward history
    // (browser back/forward should move between screens, not between tabs).
    history.replaceState(null, '', `#${buildHash(current.view, next)}`);
    window.dispatchEvent(new Event('hashchange'));
  }, []);

  return { view, getParam, navigate, setParam };
}

/**
 * Bind a screen's local tab state to the `?tab=` query in the hash, so the active
 * sub-tab is restored on refresh / deep link. Only one screen renders at a time,
 * so a single shared `tab` key is unambiguous. Invalid values fall back to the default.
 */
export function useTabParam<T extends string>(
  defaultTab: T,
  validTabs?: readonly T[],
): [T, (tab: T) => void] {
  const { getParam, setParam } = useHashRoute();
  const raw = getParam('tab');
  const tab = raw && (!validTabs || validTabs.includes(raw as T)) ? (raw as T) : defaultTab;
  const setTab = useCallback((next: T) => setParam('tab', next), [setParam]);
  return [tab, setTab];
}
