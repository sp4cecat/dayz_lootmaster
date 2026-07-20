// Server-backed store for modular loadout templates. Loadouts are stored per-map in the mission's
// .lootmaster/loadouts.json via the profile-gated /api/loadouts routes (the server resolves the
// file from the X-Profile-ID header). The server is the source of truth.

import { apiFetch } from './api';

// Resolve the profile id to send: the explicit arg when given, else the selected profile the app
// persists to localStorage (src/hooks/useLootData.js). Callers deep in the tree that lack a
// profile prop (the various "Save as Loadout" actions) rely on this fallback.
function resolveProfileId(profileId) {
  if (profileId) return profileId;
  return (typeof window !== 'undefined' && localStorage.getItem('dayz-editor:selectedProfileId')) || undefined;
}

/**
 * Load all modular loadout templates for the current map from the server.
 * @param {string} [profileId]
 * @returns {Promise<any[]>}
 */
export async function loadAllLoadouts(profileId) {
  const res = await apiFetch('/api/loadouts', { profileId: resolveProfileId(profileId) });
  if (!res.ok) throw new Error(`Failed to load loadouts (${res.status})`);
  return await res.json();
}

/**
 * Create or update one loadout on the server (upsert by id) in the current map.
 * @param {any} loadout
 * @param {string} [profileId]
 */
export async function saveLoadout(loadout, profileId) {
  const res = await apiFetch(`/api/loadouts/${encodeURIComponent(loadout.id)}`, {
    method: 'PUT',
    profileId: resolveProfileId(profileId),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(loadout),
  });
  if (!res.ok) throw new Error(`Failed to save loadout (${res.status})`);
}

/**
 * Delete one loadout from the current map by id.
 * @param {string} id
 * @param {string} [profileId]
 */
export async function deleteLoadout(id, profileId) {
  const res = await apiFetch(`/api/loadouts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    profileId: resolveProfileId(profileId),
  });
  if (!res.ok) throw new Error(`Failed to delete loadout (${res.status})`);
}
