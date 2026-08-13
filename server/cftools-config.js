/**
 * CF Tools Cloud credential + per-profile server-binding store.
 *
 * Holds the (single, install-wide) CF Tools application credentials and the
 * per-profile mapping to a CF Tools server `api_id`. Lives in its own file —
 * NOT profiles.json — because profiles are exported/dev-seeded and must never
 * carry secrets. The secret is write-only from the browser: redactedView()
 * is the only shape route handlers should ever send.
 *
 * Persistence mirrors ingest-store: debounced atomic temp+rename write to
 * server/.cache/cftools.json (gitignored), disabled entirely under a test
 * runner so fixture credentials can't clobber the real file.
 */

import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// eslint-disable-next-line no-undef
const CONFIG_FILE = process.env.CFTOOLS_CONFIG_FILE
    // eslint-disable-next-line no-undef
    ? resolve(process.env.CFTOOLS_CONFIG_FILE)
    : resolve(join(__dirname, '.cache', 'cftools.json'));

// eslint-disable-next-line no-undef
const PERSIST_DISABLED = !!process.env.VITEST || process.env.NODE_ENV === 'test';

let config = {
    application: null, // { applicationId, secret }
    servers: {},       // { [profileId]: { apiId, label } }
};

// ---- persistence ----

let saveTimer = null;
function persist() {
    if (PERSIST_DISABLED) return;
    if (saveTimer) return;
    saveTimer = setTimeout(async () => {
        saveTimer = null;
        // eslint-disable-next-line no-undef
        const tmp = `${CONFIG_FILE}.tmp-${process.pid}-${crypto.randomUUID()}`;
        try {
            await mkdir(dirname(CONFIG_FILE), { recursive: true });
            await writeFile(tmp, JSON.stringify(config, null, 2), 'utf8');
            await rename(tmp, CONFIG_FILE);
        } catch {
            try { await rm(tmp, { force: true }); } catch { /* ignore */ }
            /* best-effort; failures are non-fatal */
        }
    }, 500);
}

/** Load persisted config into memory. Call once at startup. */
export async function loadConfig() {
    try {
        const parsed = JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
        if (parsed && typeof parsed === 'object') {
            config = {
                application: parsed.application && parsed.application.applicationId && parsed.application.secret
                    ? { applicationId: String(parsed.application.applicationId), secret: String(parsed.application.secret) }
                    : null,
                servers: parsed.servers && typeof parsed.servers === 'object' ? parsed.servers : {},
            };
        }
    } catch { /* nothing saved yet */ }
}

// ---- application credentials ----

export function getAppCredentials() {
    return config.application; // null when unset
}

export function setAppCredentials({ applicationId, secret }) {
    if (!applicationId || !secret) throw new Error('applicationId and secret are required');
    config.application = { applicationId: String(applicationId), secret: String(secret) };
    persist();
}

export function clearAppCredentials() {
    config.application = null;
    persist();
}

// ---- per-profile server bindings ----

export function getServerBinding(profileId) {
    if (!profileId) return null;
    return config.servers[String(profileId)] || null;
}

export function setServerBinding(profileId, apiId, label) {
    if (!profileId) throw new Error('profileId is required');
    if (!apiId) {
        delete config.servers[String(profileId)];
    } else {
        config.servers[String(profileId)] = { apiId: String(apiId), label: label ? String(label) : null };
    }
    persist();
}

// ---- redaction ----

/** Browser-safe view: never includes the secret. */
export function redactedView() {
    const app = config.application;
    return {
        configured: !!app,
        applicationId: app ? `${app.applicationId.slice(0, 8)}…` : null,
        secretSet: !!app,
    };
}

/** Test seam: reset in-memory state (persistence is already disabled under tests). */
export function _resetState() {
    config = { application: null, servers: {} };
}
