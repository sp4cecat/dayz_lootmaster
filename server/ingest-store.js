/**
 * In-memory receiver store for the DayZ companion mod's *direct* ingest.
 *
 * Previously the mod pushed to a standalone service (spacecat API on :8787) and
 * this backend proxied to it. Now the mod POSTs snapshots/catalog straight to
 * this backend's `/ingest/*` routes (see openapi-ingest.json) and this module
 * holds the live state — no external API in the loop.
 *
 * The mod is an outbound HTTP *client*: it PUSHES a full snapshot every few
 * seconds and POLLS a command queue. So there are no deltas (each snapshot
 * replaces the last) and commands flow Node -> mod via `takePendingCommands`.
 *
 * Persistence: the catalog (config-derived; only changes on a mod rebuild) is
 * written to disk so a backend restart keeps displayName/attachment data — the
 * mod latches catalog delivery after one success and won't resend just because
 * we bounced. Snapshots are live/ephemeral and are intentionally NOT persisted
 * (modConnected reflects a fresh push, not a stale cache).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// How long since the last mod push before we report it as disconnected.
// eslint-disable-next-line no-undef
const MOD_STALE_MS = Number(process.env.DAYZ_MOD_STALE_MS || 15000);

const CATALOG_CACHE_FILE = resolve(join(__dirname, '.cache', 'ingest-catalog.json'));

let snapshot = null;   // latest live state pushed by the mod
let snapshotAt = 0;    // ms epoch of last snapshot
let catalog = null;    // { [name]: TypeDetail } — displayName / slots / etc.
let catalogAt = 0;

let commandSeq = 0;
const commands = new Map(); // id -> { id, type, args, status, result, createdAt, sentAt, ackedAt }

const now = () => Date.now();

// ---- persistence (catalog only) ----

let saveTimer = null;
function persistCatalog() {
    // Debounce: a burst of chunk POSTs collapses into a single disk write.
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        try {
            await mkdir(dirname(CATALOG_CACHE_FILE), { recursive: true });
            await writeFile(CATALOG_CACHE_FILE, JSON.stringify({ at: catalogAt, catalog }), 'utf8');
        } catch { /* best-effort cache; failures are non-fatal */ }
    }, 500);
}

/** Load any persisted catalog into memory. Call once at startup. */
export async function loadPersistedCatalog() {
    if (catalog) return;
    try {
        const parsed = JSON.parse(await readFile(CATALOG_CACHE_FILE, 'utf8'));
        if (parsed && parsed.catalog && typeof parsed.catalog === 'object') {
            catalog = parsed.catalog;
            catalogAt = parsed.at || now();
        }
    } catch { /* nothing cached yet */ }
}

// ---- snapshot (live state) ----

export function setSnapshot(data) {
    snapshot = data || {};
    snapshotAt = now();
}

export function getSnapshot() {
    return { data: snapshot, at: snapshotAt };
}

// ---- catalog (config-derived type metadata) ----

export function setCatalog(data) {
    // The mod pushes the catalog in chunks, so MERGE by default; a truthy
    // `reset` flag (first chunk of a fresh export) clears first. Accepts three
    // shapes: { items: [{name,...}] } (mod), { types: {name:{...}} }, or a bare
    // map keyed by type name.
    let incoming = {};
    if (data && Array.isArray(data.items)) {
        for (const item of data.items) {
            if (item && item.name) incoming[item.name] = item;
        }
    } else {
        incoming = data && data.types ? data.types : (data || {});
    }
    // Drop deprecated "$UNT$" (untranslated) markers — not available in-game.
    // The mod filters these at export; this guards against an older mod build.
    for (const k of Object.keys(incoming)) {
        const dn = incoming[k] && incoming[k].displayName;
        if (dn && String(dn).startsWith('$UNT$')) delete incoming[k];
    }
    if (!catalog || (data && data.reset)) catalog = {};
    Object.assign(catalog, incoming);
    catalogAt = now();
    persistCatalog();
}

export function getCatalog() {
    return { types: catalog || {}, at: catalogAt };
}

export function getTypeDetail(name) {
    if (!catalog) return null;
    return catalog[name] || null;
}

// Reverse index: attachment-slot name -> [items whose inventorySlot[] includes it].
// Answers "what items fit this slot". Memoized against catalogAt (the catalog
// arrives in chunks, so recomputing per-chunk would be wasteful).
let attachIndex = null;
let attachIndexAt = -1;

function buildAttachIndex() {
    if (attachIndex && attachIndexAt === catalogAt) return attachIndex;
    const idx = {};
    if (catalog) {
        for (const name of Object.keys(catalog)) {
            const item = catalog[name];
            const slots = item && item.inventorySlot;
            if (!Array.isArray(slots)) continue;
            for (const slot of slots) {
                // Slot names are case-insensitive in the engine but config casing
                // is inconsistent (an AK exposes "WeaponHandguardAK" while the
                // handguard's inventorySlot is "weaponHandguardAK"). Key on
                // lowercase so the join matches.
                const key = String(slot).toLowerCase();
                (idx[key] || (idx[key] = [])).push({ name, displayName: item.displayName || null });
            }
        }
    }
    attachIndex = idx;
    attachIndexAt = catalogAt;
    return idx;
}

// For an object, resolve "what can attach to it": for each slot the object
// exposes (its attachments[]), the items that fit that slot. Returns null if the
// object isn't in the catalog yet.
export function getCompatibleAttachments(name) {
    const item = catalog && catalog[name];
    if (!item) return null;
    const slots = Array.isArray(item.attachments) ? item.attachments : [];
    const idx = buildAttachIndex();
    const bySlot = {};
    let total = 0;
    for (const slot of slots) {
        const items = (idx[String(slot).toLowerCase()] || []).slice().sort((a, b) =>
            (a.displayName || a.name).localeCompare(b.displayName || b.name));
        bySlot[slot] = items; // keep the object's original slot casing as the key
        total += items.length;
    }
    return { slots, itemCount: total, bySlot };
}

// Reverse index: attachment-slot name -> [objects that EXPOSE it in attachments[]].
// The mirror of attachIndex; answers "which objects have this slot".
let exposeIndex = null;
let exposeIndexAt = -1;

function buildExposeIndex() {
    if (exposeIndex && exposeIndexAt === catalogAt) return exposeIndex;
    const idx = {};
    if (catalog) {
        for (const name of Object.keys(catalog)) {
            const item = catalog[name];
            const slots = item && item.attachments;
            if (!Array.isArray(slots)) continue;
            for (const slot of slots) {
                const key = String(slot).toLowerCase();
                (idx[key] || (idx[key] = [])).push({ name, displayName: item.displayName || null });
            }
        }
    }
    exposeIndex = idx;
    exposeIndexAt = catalogAt;
    return idx;
}

// Inverse of getCompatibleAttachments: for an ITEM, resolve "which objects accept
// it" — for each slot the item occupies (its inventorySlot[]), the objects that
// expose that slot. Returns null if the item isn't in the catalog yet.
export function getObjectsAcceptingItem(name) {
    const item = catalog && catalog[name];
    if (!item) return null;
    const slots = Array.isArray(item.inventorySlot) ? item.inventorySlot : [];
    const idx = buildExposeIndex();
    const bySlot = {};
    let total = 0;
    for (const slot of slots) {
        const objs = (idx[String(slot).toLowerCase()] || []).slice().sort((a, b) =>
            (a.displayName || a.name).localeCompare(b.displayName || b.name));
        bySlot[slot] = objs;
        total += objs.length;
    }
    return { slots, objectCount: total, bySlot };
}

export function modConnected() {
    return snapshotAt > 0 && now() - snapshotAt <= MOD_STALE_MS;
}

// ---- command queue (Node -> mod, since the mod's RestApi is outbound-only) ----

export function enqueueCommand(type, args) {
    const id = ++commandSeq;
    const cmd = {
        id,
        type,
        args: args || {},
        status: 'pending',
        result: null,
        createdAt: now(),
        sentAt: 0,
        ackedAt: 0,
    };
    commands.set(id, cmd);
    return cmd;
}

// Returns pending commands and marks them sent. The mod calls this on its poll.
export function takePendingCommands() {
    const pending = [];
    for (const cmd of commands.values()) {
        if (cmd.status === 'pending') {
            cmd.status = 'sent';
            cmd.sentAt = now();
            pending.push({ id: cmd.id, type: cmd.type, args: cmd.args });
        }
    }
    return pending;
}

export function ackCommand(id, result) {
    const cmd = commands.get(Number(id));
    if (!cmd) return false;
    cmd.status = 'done';
    cmd.result = result === undefined ? null : result;
    cmd.ackedAt = now();
    return true;
}

export function getCommand(id) {
    return commands.get(Number(id)) || null;
}

export function listCommands() {
    return [...commands.values()];
}
