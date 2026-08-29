import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import RollbackDialog from '../../src/components/history/RollbackDialog';
import type { InventoryNode, InventorySnapshot, RollbackResult } from '../../src/types/history';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_700_000_000_000;

const node = (cls: string, over: Partial<InventoryNode> = {}): InventoryNode => ({
    cls, slot: null, where: 'cargo', health01: 1, healthLevel: 0,
    quantity: null, quantityMax: null, row: null, col: null,
    displayName: null, children: [], ...over,
});

const snap = (over: Partial<InventorySnapshot> = {}): InventorySnapshot => ({
    id: 1,
    pid: '76561198000000001',
    name: 'Survivor',
    ts: T0,
    reason: 'death',
    pos: { x: 7500, y: 300, z: 2500 },
    stats: { health: 0, blood: 0, shock: 0, energy: 1500, water: 1200 },
    items: 2,
    truncated: false,
    tree: [node('M4A1'), node('Bandage')],
    ...over,
});

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
    vi.restoreAllMocks();
});

interface Props {
    snapshot?: InventorySnapshot;
    current?: InventorySnapshot | null;
    currentLoading?: boolean;
    playerOnline?: boolean;
    busy?: boolean;
    error?: string | null;
    result?: RollbackResult | null;
    onConfirm?: (o: { allowTruncated: boolean; restoreStats: boolean }) => void;
    onCaptureCurrent?: () => void;
}

function render(props: Props = {}) {
    act(() => {
        root.render(
            <RollbackDialog
                open
                snapshot={props.snapshot ?? snap()}
                current={props.current ?? null}
                currentLoading={props.currentLoading ?? false}
                playerOnline={props.playerOnline ?? true}
                busy={props.busy ?? false}
                error={props.error ?? null}
                result={props.result ?? null}
                onCaptureCurrent={props.onCaptureCurrent ?? (() => {})}
                onConfirm={props.onConfirm ?? (() => {})}
                onClose={() => {}}
            />,
        );
    });
}

// The dialog renders through Modal, which portals — so query the document, not
// the container the root was mounted into.
const text = () => document.body.textContent || '';
const buttons = () => [...document.body.querySelectorAll('button')];
const button = (label: string) => buttons().find(b => b.textContent?.includes(label))!;
const checkboxes = () => [...document.body.querySelectorAll('input[type=checkbox]')] as HTMLInputElement[];

describe('the duplication warning', () => {
    it('is stated plainly and not buried', () => {
        // There is no way to avoid it — the economy has no memory of where an item
        // came from — so the only honest handling is to say so every time.
        render();
        expect(text()).toContain('This duplicates items');
    });
});

describe('the truncation gate', () => {
    it('blocks a truncated snapshot until it is acknowledged', () => {
        render({ snapshot: snap({ truncated: true }) });
        expect(button('Apply rollback').disabled).toBe(true);

        const ack = checkboxes()[0];
        act(() => { ack.click(); });
        expect(button('Apply rollback').disabled).toBe(false);
    });

    it('does not ask for an acknowledgement it does not need', () => {
        render();
        expect(text()).not.toContain('knowing this capture is incomplete');
        expect(button('Apply rollback').disabled).toBe(false);
    });

    it('passes the override through to the caller', () => {
        const onConfirm = vi.fn();
        render({ snapshot: snap({ truncated: true }), onConfirm });
        act(() => { checkboxes()[0].click(); });
        act(() => { button('Apply rollback').click(); });
        expect(onConfirm).toHaveBeenCalledWith({ allowTruncated: true, restoreStats: false });
    });
});

describe('restoring vitals', () => {
    it('is refused for a death snapshot, which would kill the restored character', () => {
        // The commonest rollback of all is "put them back the way they were before
        // they died", and that snapshot records health 0.
        render({ snapshot: snap({ reason: 'death' }) });
        const stats = checkboxes()[0];
        expect(stats.disabled).toBe(true);
        expect(text()).toContain('would kill the character it just restored');
    });

    it('is offered when the snapshot recorded a living character', () => {
        render({
            snapshot: snap({
                reason: 'disconnect',
                stats: { health: 87, blood: 5000, shock: 100, energy: 1500, water: 1200 },
            }),
        });
        expect(checkboxes()[0].disabled).toBe(false);
    });
});

describe('the diff', () => {
    it('distinguishes "carrying nothing" from "we have not looked"', () => {
        // Rendering an unknown inventory as an empty destroy list would tell the
        // operator nothing is at risk when in fact everything is.
        render({ current: null });
        expect(text()).toContain('unknown');
        expect(text()).not.toContain('Destroyed');
    });

    it('lists what comes back and what goes when a capture is available', () => {
        render({
            current: snap({ id: 2, reason: 'manual', tree: [node('Ammo_762x39')] }),
        });
        expect(text()).toContain('Restored');
        expect(text()).toContain('Destroyed');
        expect(text()).toContain('Ammo_762x39');
        expect(text()).toContain('M4A1');
    });
});

describe('the online gate', () => {
    it('refuses to apply onto a character that is not loaded', () => {
        render({ playerOnline: false });
        expect(button('Apply rollback').disabled).toBe(true);
        expect(text()).toContain('not online');
    });
});

describe('the outcome', () => {
    it('reports counts rather than a tick, so a partial apply is visible', () => {
        render({
            result: {
                applied: true, snapshotId: 1, playerId: 'x', expected: 11,
                created: 9, failed: 2, misplaced: 1, removed: 4,
            },
        });
        expect(text()).toContain('9 of 11 items rebuilt');
        expect(text()).toContain('2 could not be created');
        expect(text()).toContain('1 went into cargo');
    });

    it('says so when the rollback did not complete', () => {
        render({
            result: {
                applied: false, snapshotId: 1, playerId: 'x', expected: 11,
                created: 0, error: 'rollback is disabled in spacecat_api.json',
            },
        });
        expect(text()).toContain('Rollback did not complete');
        expect(text()).toContain('disabled in spacecat_api.json');
    });

    it('replaces the confirm button once there is an outcome to read', () => {
        render({ result: { applied: true, snapshotId: 1, playerId: 'x', expected: 2, created: 2 } });
        expect(buttons().some(b => b.textContent?.includes('Apply rollback'))).toBe(false);
        expect(button('Close')).toBeTruthy();
    });
});
