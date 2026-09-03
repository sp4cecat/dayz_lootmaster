/**
 * End-to-end check for the boot progress indicator.
 *
 * Drives a headless Chromium over CDP (Node 24's native WebSocket — no puppeteer in
 * this repo), seeds the localStorage keys the app gates on, reloads, and samples the
 * boot strip while the pipeline runs. Verifies both that the indicator reports real
 * phases and that the parallelised loaders still produce a working app.
 *
 * Usage: node tools/verify-boot-progress.mjs [appUrl]
 */
const APP_URL = process.argv[2] || 'http://localhost:4199/';
const BROWSER =
    process.env.BROWSER_PATH ||
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;

import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'lm-verify-'));
const browser = spawn(
    BROWSER,
    [
        '--headless=new',
        `--remote-debugging-port=${PORT}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-gpu',
        'about:blank',
    ],
    { stdio: 'ignore' },
);

let ws;
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

function send(method, params = {}, sessionId) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
            if (pending.delete(id)) reject(new Error(`${method} timed out`));
        }, 30000);
    });
}

let sessionId;
async function evaluate(expression) {
    const res = await send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        sessionId,
    );
    if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.exception?.description || 'eval failed');
    }
    return res.result?.value;
}

async function connect() {
    for (let i = 0; i < 40; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            const info = await res.json();
            return info.webSocketDebuggerUrl;
        } catch {
            await sleep(250);
        }
    }
    throw new Error('browser did not expose a CDP endpoint');
}

const results = [];
function check(name, ok, detail = '') {
    results.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Poll the injected recorder until the run settles, then return everything it saw. */
async function waitForBootLog() {
    for (let i = 0; i < 200; i++) {
        await sleep(100);
        const done = await evaluate(
            `(window.__bootLog || []).some(e => e.status === 'ready' || e.status === 'error')`,
        );
        if (done) break;
    }
    return (await evaluate(`window.__bootLog || []`)) || [];
}

try {
    const wsUrl = await connect();
    ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
        } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
            consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
        } else if (msg.method === 'Runtime.exceptionThrown') {
            consoleErrors.push(
                msg.params.exceptionDetails.exception?.description ||
                    msg.params.exceptionDetails.text,
            );
        }
    };

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    await send('Network.enable', {}, sessionId);

    // A local load finishes in ~0.3 s, far too fast to sample intermediate phases and
    // nothing like the LAN share this feature exists for. 150 ms of added latency per
    // request approximates the SMB round trip the user actually pays.
    await send(
        'Network.emulateNetworkConditions',
        {
            offline: false,
            latency: 150,
            downloadThroughput: -1,
            uploadThroughput: -1,
        },
        sessionId,
    );

    // Record every state the strip passes through, rather than polling and hoping to
    // catch transient phases. Reinstalled on every navigation.
    await send(
        'Page.addScriptToEvaluateOnNewDocument',
        {
            source: `
                window.__bootLog = [];
                new MutationObserver(() => {
                    const el = document.querySelector('[data-boot-progress]');
                    if (!el) return;
                    const entry = {
                        status: el.getAttribute('data-boot-progress'),
                        text: (el.innerText || '').replace(/\\s+/g, ' ').trim(),
                    };
                    const last = window.__bootLog[window.__bootLog.length - 1];
                    if (!last || last.text !== entry.text) window.__bootLog.push(entry);
                // Observe the document, not documentElement: this script runs before the
                // document element exists, so documentElement is still null here.
                }).observe(document, {
                    subtree: true, childList: true, characterData: true, attributes: true,
                });
            `,
        },
        sessionId,
    );

    // Seed the gates: an editor id (else we sit on the login screen) and the profile
    // the running API actually serves.
    await send('Page.navigate', { url: APP_URL }, sessionId);
    await sleep(1500);
    const profiles = await (await fetch('http://localhost:4317/api/profiles')).json();
    if (!profiles.length) throw new Error('the API on :4317 has no profiles to load');
    await evaluate(`
        localStorage.setItem('dayz-editor:id', 'verify-bot');
        localStorage.setItem('dayz-editor:selectedProfileId', ${JSON.stringify(profiles[0].id)});
        'ok'
    `);

    // --- cold boot: no IndexedDB, so every file comes off the wire ------------
    await evaluate(`indexedDB.deleteDatabase('dayz-types-editor'); 'ok'`);
    consoleErrors.length = 0;
    await send('Page.navigate', { url: APP_URL }, sessionId);

    const coldLog = await waitForBootLog();
    const coldTexts = coldLog.map((e) => e.text);
    const coldPhases = new Set(coldTexts.map((t) => t.split('—')[0].trim()).filter(Boolean));

    check('boot indicator renders during a cold load', coldLog.length > 0);
    check(
        'reports multiple named phases',
        coldPhases.size >= 3,
        [...coldPhases].slice(0, 6).join(' | '),
    );
    check(
        'shows an n/M file counter',
        coldTexts.some((t) => /\(\d+ \/ \d+\)/.test(t)),
        coldTexts.find((t) => /\(\d+ \/ \d+\)/.test(t))?.slice(0, 70) || 'never seen',
    );
    check(
        'attributes cold-load files to the network',
        coldTexts.some((t) => /from network/.test(t)),
    );

    // The app itself must still work — the parallelised loaders are the real risk.
    const coldData = await evaluate(`
        (async () => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('dayz-types-editor');
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
            });
            const tx = db.transaction('lootTypes', 'readonly');
            const all = await new Promise((res, rej) => {
                const r = tx.objectStore('lootTypes').getAll();
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
            });
            return {
                fileCount: all.length,
                totalTypes: all.reduce((n, r) => n + (r.types?.length || 0), 0),
                ids: all.map(r => r.id).sort(),
            };
        })()
    `);

    check(
        'cold load populated the type cache',
        coldData.fileCount > 0 && coldData.totalTypes > 0,
        `${coldData.fileCount} files, ${coldData.totalTypes} types`,
    );

    // --- warm boot: IndexedDB is populated, so the session pass short-circuits --
    consoleErrors.length = 0;
    await send('Page.navigate', { url: APP_URL }, sessionId);
    const warmLog = await waitForBootLog();
    const warmTexts = warmLog.map((e) => e.text);

    const cacheLine = warmTexts.find((t) => /from cache|restored \d+ loot type files/.test(t));
    check('warm load reports data served from cache', Boolean(cacheLine), cacheLine?.slice(0, 70));

    const warmSummary = warmTexts.filter((t) => /^Ready/.test(t)).pop() || '';
    check('warm load ends in a Ready summary', warmSummary.length > 0, warmSummary.slice(0, 90));

    // An absent optional file is not a failure. The session pass is handed the types
    // structure and asks for names the spawnabletypes endpoint rejects; the original
    // code skipped those silently, so the indicator must not cry wolf about them.
    const noisy = [...coldTexts, ...warmTexts].filter((t) => /\d+ failed/.test(t));
    check(
        'does not report expected absences as failures',
        noisy.length === 0,
        noisy[0]?.slice(0, 80) || '',
    );

    const warmData = await evaluate(`
        (async () => {
            const db = await new Promise((res, rej) => {
                const r = indexedDB.open('dayz-types-editor');
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
            });
            const tx = db.transaction('lootTypes', 'readonly');
            const all = await new Promise((res, rej) => {
                const r = tx.objectStore('lootTypes').getAll();
                r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
            });
            return {
                fileCount: all.length,
                totalTypes: all.reduce((n, r) => n + (r.types?.length || 0), 0),
                ids: all.map(r => r.id).sort(),
            };
        })()
    `);

    check(
        'warm load yields identical data to the cold load',
        warmData.fileCount === coldData.fileCount &&
            warmData.totalTypes === coldData.totalTypes &&
            JSON.stringify(warmData.ids) === JSON.stringify(coldData.ids),
        `cold ${coldData.fileCount}/${coldData.totalTypes} vs warm ${warmData.fileCount}/${warmData.totalTypes}`,
    );

    const appAlive = await evaluate(
        `!!document.querySelector('nav, aside, main') && document.body.innerText.length > 50`,
    );
    check('app shell rendered after boot', appAlive);

    const realErrors = consoleErrors.filter(
        (e) => !/favicon|Download the React DevTools|net::ERR_/.test(e),
    );
    check('no console errors during boot', realErrors.length === 0, realErrors.slice(0, 3).join(' ; '));


} catch (e) {
    check('harness completed', false, e.message);
} finally {
    try {
        ws?.close();
    } catch { /* ignore */ }
    browser.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
