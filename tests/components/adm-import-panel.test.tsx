import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import AdmImportPanel from '../../src/components/history/AdmImportPanel';
import { fmtOffset } from '../../src/utils/formatOffset';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const SCAN = {
    root: 'C:/srv/log_storage',
    defaultRoot: 'C:/srv/log_storage',
    profileTimeZone: 'Australia/Sydney',
    offset: { offsetMinutes: 660, source: 'mtime', votes: 19, total: 19, disagreement: 0 },
    zone: {
        timeZone: 'Australia/Sydney',
        offsetMinutes: null,
        offsets: [{ minutes: 660, files: 19, label: 'AEDT' }],
        agree: 19,
        conflict: 0,
        conflictOffset: null,
    },
    ledger: { ok: true, size: 42, path: 'C:/srv/profiles/spacecat/guid_ledger.json', error: null },
    files: [
        { path: 'a.ADM', bytes: 500_000, startsAt: 1_700_000_000_000, detectedOffset: 660, detectedSource: 'mtime', confident: true, skip: null },
        { path: 'b.ADM', bytes: 1_000, startsAt: null, detectedOffset: null, detectedSource: null, confident: false, skip: 'no date in header or filename' },
    ],
};

const IDLE = { idle: true, running: false };

function mockApi(over: Record<string, unknown> = {}) {
    const posts: { url: string; body: unknown }[] = [];
    let jobState: unknown = over.job ?? IDLE;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes('/api/logs/adm/scan')) {
            return { ok: true, json: async () => over.scan ?? SCAN } as Response;
        }
        if (url.includes('/api/logs/adm/import')) {
            if (init?.method === 'POST') {
                posts.push({ url, body: JSON.parse(String(init.body)) });
                jobState = over.afterStart ?? { idle: false, running: true, totalFiles: 1, progress: null };
                return { ok: true, json: async () => jobState } as Response;
            }
            return { ok: true, json: async () => jobState } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, posts };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

async function render() {
    await act(async () => { root.render(<AdmImportPanel selectedProfileId="p1" />); });
    await act(async () => { await Promise.resolve(); });
}

const text = () => container.textContent || '';
const button = (label: string) =>
    [...container.querySelectorAll('button')].find(b => b.textContent?.includes(label))!;

async function scan() {
    await act(async () => { button('Scan').click(); });
    await act(async () => { await Promise.resolve(); });
}

const selectFor = (label: string) =>
    [...container.querySelectorAll('select')].find(s => s.getAttribute('aria-label') === label)!;

const selectValue = (label: string) => selectFor(label).value;

async function selectZone(value: string) {
    const el = selectFor('Log timezone');
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLSelectElement.prototype, 'value')!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => { await Promise.resolve(); });
}

describe('fmtOffset', () => {
    it('renders whole and half-hour zones', () => {
        expect(fmtOffset(660)).toBe('UTC+11:00');
        expect(fmtOffset(0)).toBe('UTC+00:00');
        expect(fmtOffset(-330)).toBe('UTC-05:30');
        expect(fmtOffset(345)).toBe('UTC+05:45');   // Nepal is a real offset
    });
});

describe('AdmImportPanel', () => {
    it('does not scan or import until asked', async () => {
        // Walking a multi-gigabyte archive on mount would be a nasty surprise.
        const { fetchMock } = mockApi();
        await render();
        const urls = fetchMock.mock.calls.map(c => String(c[0]));
        expect(urls.some(u => u.includes('/scan'))).toBe(false);
    });

    it('shows the zone the logs will be read in, and what it resolves to', async () => {
        // The zone is a setting, not a fact in the data. Hiding it would let a
        // silently wrong one put every imported position at the wrong moment.
        mockApi();
        await render();
        await scan();
        expect(text()).toContain('AEDT');
        expect(text()).toContain('UTC+11:00');
        expect(selectValue('Log timezone')).toBe('Australia/Sydney');
    });

    it('confirms the zone against the files own timestamps', async () => {
        mockApi();
        await render();
        await scan();
        expect(text()).toContain('Confirmed against 19 file(s)');
    });

    it('says so when nothing in the archive can check the zone', async () => {
        // Every file copied or edited: the mtimes are meaningless and the operator
        // is on their own. Better to say that than to imply verification happened.
        mockApi({ scan: { ...SCAN, zone: { ...SCAN.zone, agree: 0 } } });
        await render();
        await scan();
        expect(text()).toContain('nothing here can check the timezone');
    });

    it('warns when the files contradict the chosen zone, and says what they said', async () => {
        mockApi({
            scan: {
                ...SCAN,
                zone: { ...SCAN.zone, timeZone: 'Australia/Brisbane', agree: 0, conflict: 4, conflictOffset: 660 },
            },
        });
        await render();
        await scan();
        expect(text()).toContain('4 file(s) were last written at UTC+11:00');
    });

    it('flags an archive that straddles a daylight-saving change', async () => {
        // The whole reason this is a zone and not a number: one offset would put
        // half of these files an hour out.
        mockApi({
            scan: {
                ...SCAN,
                zone: {
                    ...SCAN.zone,
                    offsets: [
                        { minutes: 600, files: 12, label: 'AEST' },
                        { minutes: 660, files: 25, label: 'AEDT' },
                    ],
                },
            },
        });
        await render();
        await scan();
        expect(text()).toContain('spans a daylight-saving change');
        expect(text()).toContain('AEST');
        expect(text()).toContain('AEDT');
    });

    it('explains a missing GUID ledger instead of silently mis-attributing players', async () => {
        mockApi({ scan: { ...SCAN, ledger: { ok: false, size: 0, path: 'x.json', error: 'not found' } } });
        await render();
        await scan();
        expect(text()).toContain('will not merge with mod-recorded history');
    });

    it('counts only importable files', async () => {
        // One of the two fixtures is unusable; offering to import it would be a lie.
        mockApi();
        await render();
        await scan();
        expect(button('Import')).toBeTruthy();
        expect(button('Import').textContent).toContain('1 file(s)');
    });

    it('imports in the chosen zone, not the profile default', async () => {
        const { posts } = mockApi();
        await render();
        await scan();

        await selectZone('Australia/Brisbane');
        await act(async () => { button('Import').click(); });
        await act(async () => { await Promise.resolve(); });

        expect(posts).toHaveLength(1);
        expect(posts[0].body).toMatchObject({ timeZone: 'Australia/Brisbane' });
    });

    it('re-scans when the zone changes, so the preview matches what would be imported', async () => {
        // The dates listed and the agreement count are both read through the zone;
        // leaving them stale would show one answer and import another.
        const { fetchMock } = mockApi();
        await render();
        await scan();
        const before = fetchMock.mock.calls.filter(c => String(c[0]).includes('/scan')).length;

        await selectZone('Australia/Brisbane');

        const after = fetchMock.mock.calls.filter(c => String(c[0]).includes('/scan'));
        expect(after.length).toBe(before + 1);
        expect(String(after[after.length - 1][0])).toContain('timeZone=Australia%2FBrisbane');
    });

    it('falls back to a fixed offset for an archive with no known zone', async () => {
        const { posts } = mockApi();
        await render();
        await scan();

        await selectZone('__fixed__');
        const offsetInput = [...container.querySelectorAll('input')]
            .find(i => i.getAttribute('aria-label') === 'UTC offset in minutes')!;
        await act(async () => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value')!.set!;
            setter.call(offsetInput, '600');
            offsetInput.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await act(async () => { button('Import').click(); });
        await act(async () => { await Promise.resolve(); });

        expect(posts).toHaveLength(1);
        expect(posts[0].body).toMatchObject({ offsetMinutes: 600 });
        expect(posts[0].body).not.toHaveProperty('timeZone');
    });

    it('adopts an import already running on the server', async () => {
        // The job outlives this component; remounting must not show an idle panel
        // next to a server that is mid-write.
        mockApi({ job: { idle: false, running: true, totalFiles: 12, progress: { files: 3, inserted: 900 } } });
        await render();
        expect(text()).toContain('3 of 12 files');
    });

    it('reports what a finished import actually stored', async () => {
        mockApi({
            job: {
                idle: false, running: false,
                result: {
                    files: 37, skipped: 0, rows: 28840, inserted: 23404, events: 3212,
                    resolved: 0, unresolved: 28840, unresolvedGuids: 276, ambiguous: 0,
                    firstTs: 1_700_000_000_000, lastTs: 1_700_900_000_000, errors: [],
                },
            },
        });
        await render();
        expect(text()).toContain('Import complete');
        expect(text()).toContain('23,404 rows stored');
        // The difference between parsed and stored is real information: overlapping
        // archives are common and "5,436 already present" explains the shortfall.
        expect(text()).toContain('5,436 already present');
        expect(text()).toContain('276 player(s) could not be matched');
    });

    it('reports a failed import rather than looking idle', async () => {
        mockApi({ job: { idle: false, running: false, error: 'EACCES: permission denied' } });
        await render();
        expect(text()).toContain('Import failed');
        expect(text()).toContain('EACCES: permission denied');
    });
});
