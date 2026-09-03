// Shared backend API helpers. Previously this logic (base-URL resolution + the
// X-Profile-ID header) was copy-pasted across useLootData, useItemScan,
// useTypeCatalog, loadoutStore and ~16 components. Everything now routes through here.
//
// Because it is the single choke point, it also feeds the boot indicator's ambient
// in-flight counter. That counter is display-only — it never drives the progress
// percentage, which comes from the named steps useLootData emits. Keeping the two
// channels separate is what makes double-counting impossible.

import { noteRequest, noteResponse } from '@/stores/bootProgress';

/**
 * Resolve the app's backend base URL: the current host on port 4317 by default,
 * overridable via localStorage['dayz-editor:apiBase'] (trailing slashes stripped).
 */
export function getApiBase(): string {
    const savedBase = typeof window !== 'undefined' ? localStorage.getItem('dayz-editor:apiBase') : null;
    const defaultBase = typeof window !== 'undefined'
        ? `${window.location.protocol}//${window.location.hostname}:4317`
        : 'http://localhost:4317';
    return (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/, '') : defaultBase;
}

export interface ApiFetchOptions extends RequestInit {
    /** Selected profile id; sent as the X-Profile-ID header the server gates profile routes on. */
    profileId?: string | null;
}

/**
 * fetch() wrapper that prefixes the API base for root-relative paths and injects the
 * X-Profile-ID header when a profileId is supplied. Absolute URLs are passed through unchanged.
 */
export function apiFetch(path: string, { profileId, headers, ...options }: ApiFetchOptions = {}): Promise<Response> {
    const url = /^https?:\/\//i.test(path) ? path : `${getApiBase()}${path.startsWith('/') ? '' : '/'}${path}`;
    const mergedHeaders: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
    if (profileId) mergedHeaders['X-Profile-ID'] = profileId;
    noteRequest();
    // Note this resolves when headers land, not when the caller has read the body — so
    // the counter under-reports large XML payloads. That is fine for an "is it moving?"
    // signal; the determinate channel is what measures real progress.
    return fetch(url, { ...options, headers: mergedHeaders }).finally(noteResponse);
}
