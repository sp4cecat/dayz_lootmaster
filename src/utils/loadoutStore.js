// Server-backed store for modular loadout templates. Loadouts are shared/global (not keyed
// by profile) and persisted in the backend's loadouts.json via the /api/loadouts routes. The
// server is the source of truth; these replace the former IndexedDB-only persistence.

/** Resolve the API base URL the same way the rest of the app does (localStorage override,
 *  else the current host on port 4317). Mirrors getApiBase in useLootData.js. */
function apiBase() {
  const saved = typeof window !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
  const def = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.hostname}:4317`
    : 'http://localhost:4317';
  return (saved && saved.trim()) ? saved.trim().replace(/\/+$/, '') : def;
}

/**
 * Load all modular loadout templates from the server.
 * @returns {Promise<any[]>}
 */
export async function loadAllLoadouts() {
  const res = await fetch(`${apiBase()}/api/loadouts`);
  if (!res.ok) throw new Error(`Failed to load loadouts (${res.status})`);
  return await res.json();
}

/**
 * Create or update one loadout on the server (upsert by id).
 * @param {any} loadout
 */
export async function saveLoadout(loadout) {
  const res = await fetch(`${apiBase()}/api/loadouts/${encodeURIComponent(loadout.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loadout),
  });
  if (!res.ok) throw new Error(`Failed to save loadout (${res.status})`);
}

/**
 * Delete one loadout from the server by id.
 * @param {string} id
 */
export async function deleteLoadout(id) {
  const res = await fetch(`${apiBase()}/api/loadouts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Failed to delete loadout (${res.status})`);
}
