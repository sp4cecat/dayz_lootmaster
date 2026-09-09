import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ActionFeed from '../../src/components/history/ActionFeed';
import type { ActionKindCount, HistoryAction } from '../../src/types/history';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_700_000_000_000;

const action = (over: Partial<HistoryAction> = {}): HistoryAction => ({
    id: 1,
    ts: T0,
    pid: '76561198000000001',
    name: 'Survivor',
    kind: 'pickup',
    cls: 'M4A1',
    x: 7500,
    y: 300,
    z: 2500,
    detail: null,
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
    actions?: HistoryAction[];
    kindCounts?: ActionKindCount[];
    selectedKinds?: string[];
    onToggleKind?: (k: string) => void;
    onClearKinds?: () => void;
    loading?: boolean;
    error?: string | null;
    truncated?: boolean;
    totalRecorded?: number;
}

function render(props: Props = {}) {
    act(() => {
        root.render(
            <ActionFeed
                actions={props.actions ?? []}
                kindCounts={props.kindCounts ?? []}
                selectedKinds={props.selectedKinds ?? []}
                onToggleKind={props.onToggleKind ?? (() => {})}
                onClearKinds={props.onClearKinds ?? (() => {})}
                loading={props.loading ?? false}
                error={props.error ?? null}
                truncated={props.truncated ?? false}
                totalRecorded={props.totalRecorded}
            />,
        );
    });
}

const text = () => container.textContent || '';
const buttons = () => [...container.querySelectorAll('button')];
const chip = (label: string) => buttons().find(b => b.textContent?.includes(label))!;

describe('the filter chips', () => {
    it('are built from the window, not from what survived the filter', () => {
        // The classic filter trap: rebuilding the chips from the filtered result
        // deletes the very chips needed to widen it again. So the counts describe
        // the window and the list describes the filter.
        render({
            actions: [action({ kind: 'death' })],
            kindCounts: [{ kind: 'pickup', count: 12 }, { kind: 'death', count: 1 }],
            selectedKinds: ['death'],
        });
        expect(chip('Picked up')).toBeTruthy();
        expect(text()).toContain('12');
    });

    it('reports its own pressed state', () => {
        render({
            kindCounts: [{ kind: 'pickup', count: 3 }],
            selectedKinds: ['pickup'],
        });
        expect(chip('Picked up').getAttribute('aria-pressed')).toBe('true');
    });

    it('gives an unrecognised kind a readable label rather than hiding it', () => {
        // The mod decides what it emits and may emit something this build has never
        // heard of. Dropping it silently would hide the one event type that mattered.
        render({ kindCounts: [{ kind: 'vehicle_theft', count: 2 }] });
        expect(text()).toContain('vehicle theft');
    });

    it('offers a way out only when a filter is applied', () => {
        render({ kindCounts: [{ kind: 'pickup', count: 1 }] });
        expect(text()).not.toContain('Clear filter');
        render({ kindCounts: [{ kind: 'pickup', count: 1 }], selectedKinds: ['pickup'] });
        expect(text()).toContain('Clear filter');
    });

    it('toggles the kind it names', () => {
        const onToggleKind = vi.fn();
        render({ kindCounts: [{ kind: 'drop', count: 4 }], onToggleKind });
        act(() => { chip('Dropped').click(); });
        expect(onToggleKind).toHaveBeenCalledWith('drop');
    });
});

describe('the empty state', () => {
    it('distinguishes a mod with no event hooks from a quiet server', () => {
        // These need completely different responses — one is "update the mod", the
        // other is "nothing happened" — so they must not share a message.
        render({ totalRecorded: 0 });
        expect(text()).toContain('spacecat_dayz_server_api 1.2.0');
    });

    it('blames the filter when a filter is applied', () => {
        render({ totalRecorded: 500, selectedKinds: ['death'] });
        expect(text()).toContain('selected kinds');
    });

    it('says the window is empty when nothing is filtered', () => {
        render({ totalRecorded: 500 });
        expect(text()).toContain('No actions recorded in this window');
        expect(text()).not.toContain('selected kinds');
    });
});

describe('the feed', () => {
    it('renders a row per action with its class and place', () => {
        render({ actions: [action()] });
        expect(text()).toContain('Survivor');
        expect(text()).toContain('M4A1');
        expect(text()).toContain('7500, 2500');
    });

    it('names an unattributed event rather than leaving it blank', () => {
        // A tent the CE cleaned up has no actor. "Unattributed" is a fact; an empty
        // line looks like a rendering bug.
        render({ actions: [action({ pid: null, name: null, kind: 'destroy' })] });
        expect(text()).toContain('Unattributed');
    });

    it('reads a death detail as a sentence', () => {
        render({ actions: [action({ kind: 'death', detail: 'killer=76561198000000002' })] });
        expect(text()).toContain('Killed by 76561198000000002');
    });

    it('summarises a rollback audit row from its JSON', () => {
        render({
            actions: [action({
                kind: 'rollback',
                detail: JSON.stringify({ snapshotId: 4, expected: 11, created: 11, misplaced: 2 }),
            })],
        });
        expect(text()).toContain('snapshot #4');
        expect(text()).toContain('11/11 items');
        expect(text()).toContain('2 misplaced');
    });

    it('shows a detail it does not recognise rather than dropping it', () => {
        render({ actions: [action({ kind: 'rollback', detail: 'not json at all' })] });
        expect(text()).toContain('not json at all');
    });

    it('says when the limit bit, instead of looking like the end of the data', () => {
        render({ actions: [action()], truncated: true });
        expect(text()).toContain('Only the most recent events are shown');
    });
});

describe('combat rows', () => {
    it('reads a hit as a sentence with zone, damage, weapon and range', () => {
        render({
            actions: [action({
                kind: 'hit', cls: 'ZmbM_HermitSkinny_Base',
                detail: 'victim=infected;zone=Head;dmg=102.4;ammo=Bullet_556x45;with=M4A1;dist=18.9;at=1,2,3',
            })],
        });
        expect(text()).toContain('Hit infected · Head · 102 dmg · M4A1 · 19 m');
    });

    it('names the victim of a kill', () => {
        render({
            actions: [action({
                kind: 'kill', cls: 'SurvivorM_Mirek',
                detail: 'victim=player:76561198000000002;zone=Torso;dmg=80;ammo=Bullet_762x39;with=AKM;dist=40.2;at=1,2,3',
            })],
        });
        expect(text()).toContain('Killed player 76561198000000002');
    });

    it('reads damage taken from a creature and from a fall', () => {
        render({
            actions: [
                action({ id: 1, kind: 'damaged', cls: 'ZmbM_HermitSkinny_Base', detail: 'by=infected;zone=Torso;dmg=5;ammo=MeleeInfected;with=' }),
                action({ id: 2, kind: 'damaged', cls: 'FallDamageHealth', detail: 'by=fall;zone=;dmg=12.3;ammo=FallDamageHealth;with=' }),
                action({ id: 3, kind: 'damaged', cls: 'SurvivorM_Mirek', detail: 'by=ai;zone=Torso;dmg=20;ammo=Bullet_556x45;with=AUG A1;src=Mirek' }),
            ],
        });
        expect(text()).toContain('By infected · Torso · 5 dmg');
        expect(text()).toContain('By a fall · 12 dmg');
        expect(text()).toContain('By AI Mirek · Torso · 20 dmg · AUG A1');
    });

    it('shows a combat detail it cannot parse verbatim rather than dropping it', () => {
        // A newer mod build might change the format; the raw text still tells the
        // operator something, a blank line tells them nothing.
        render({ actions: [action({ kind: 'hit', detail: 'garbage' })] });
        expect(text()).toContain('garbage');
    });

    it('labels the kill chip', () => {
        render({ kindCounts: [{ kind: 'kill', count: 3 }, { kind: 'hit', count: 40 }, { kind: 'damaged', count: 7 }] });
        expect(chip('Killed')).toBeTruthy();
        expect(chip('Hit')).toBeTruthy();
        expect(chip('Damaged')).toBeTruthy();
    });
});
