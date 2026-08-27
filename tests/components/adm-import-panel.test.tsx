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
    offset: { offsetMinutes: 660, source: 'mtime', votes: 19, total: 19, disagreement: 0 },
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

    it('shows the detected timezone and where it came from', async () => {
        // The offset is inferred, never recorded. Hiding that would let a silently
        // wrong zone put every imported position at the wrong moment.
        mockApi();
        await render();
        await scan();
        expect(text()).toContain('UTC+11:00');
        expect(text()).toContain('Detected from file times');
    });

    it('warns when the timezone could not be detected', async () => {
        mockApi({ scan: { ...SCAN, offset: { ...SCAN.offset, source: 'default', votes: 0 } } });
        await render();
        await scan();
        expect(text()).toContain('Not detected');
    });

    it('surfaces disagreement between files', async () => {
        mockApi({ scan: { ...SCAN, offset: { ...SCAN.offset, disagreement: 4 } } });
        await render();
        await scan();
        expect(text()).toContain('4 file(s) disagreed');
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

    it('sends the chosen offset, not just the detected one', async () => {
        const { posts } = mockApi();
        await render();
        await scan();

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
                    resolved: 0, unresolved: 28840, unresolvedGuids: 276,
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
