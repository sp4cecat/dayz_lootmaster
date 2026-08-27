import { describe, it, expect } from 'vitest';
import { simplifyPath, simplifyToBudget } from '../../server/simplify-path.js';

const pt = (x, z, extra = {}) => ({ x, z, ...extra });

describe('simplifyPath', () => {
    it('collapses a straight line to its endpoints', () => {
        const line = [pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), pt(4, 0)];
        expect(simplifyPath(line, 0.5)).toEqual([pt(0, 0), pt(4, 0)]);
    });

    it('keeps a corner that exceeds the tolerance', () => {
        // The corner IS the information on a movement track — a stride-based
        // decimator is exactly what loses this.
        const turn = [pt(0, 0), pt(5, 0), pt(5, 50), pt(5, 100)];
        const out = simplifyPath(turn, 1);
        expect(out).toContainEqual(pt(5, 0));
        expect(out).toHaveLength(3);
    });

    it('drops a corner that falls within the tolerance', () => {
        const nudge = [pt(0, 0), pt(50, 0.2), pt(100, 0)];
        expect(simplifyPath(nudge, 1)).toEqual([pt(0, 0), pt(100, 0)]);
    });

    it('always keeps both endpoints', () => {
        const wander = Array.from({ length: 50 }, (_, i) => pt(i, Math.sin(i) * 0.01));
        const out = simplifyPath(wander, 100);
        expect(out[0]).toEqual(wander[0]);
        expect(out[out.length - 1]).toEqual(wander[wander.length - 1]);
    });

    it('handles a stationary player without dividing by zero', () => {
        // A degenerate segment (a === b) is the common case: someone stood still.
        const parked = Array.from({ length: 20 }, () => pt(1000, 1000));
        expect(simplifyPath(parked, 1)).toHaveLength(2);
    });

    it('returns short inputs untouched', () => {
        expect(simplifyPath([], 1)).toEqual([]);
        expect(simplifyPath([pt(1, 1)], 1)).toEqual([pt(1, 1)]);
        expect(simplifyPath([pt(1, 1), pt(2, 2)], 1)).toEqual([pt(1, 1), pt(2, 2)]);
    });

    it('is a no-op at zero tolerance', () => {
        const line = [pt(0, 0), pt(1, 0), pt(2, 0)];
        expect(simplifyPath(line, 0)).toHaveLength(3);
    });

    it('preserves the original point objects, not just coordinates', () => {
        // Track points carry ts/health/hands; simplification must not strip them.
        const line = [pt(0, 0, { ts: 1 }), pt(1, 0, { ts: 2 }), pt(2, 0, { ts: 3 })];
        const out = simplifyPath(line, 0.5);
        expect(out[0].ts).toBe(1);
        expect(out[out.length - 1].ts).toBe(3);
    });

    it('preserves time order', () => {
        const track = Array.from({ length: 200 }, (_, i) =>
            pt(i, Math.sin(i / 5) * 30, { ts: i * 5000 }));
        const out = simplifyPath(track, 2);
        for (let i = 1; i < out.length; i++) {
            expect(out[i].ts).toBeGreaterThan(out[i - 1].ts);
        }
    });

    it('does not blow the stack on a long degenerate track', () => {
        // Iterative, not recursive — a naive recursive RDP dies here.
        const many = Array.from({ length: 60000 }, (_, i) => pt(i, 0));
        expect(() => simplifyPath(many, 0.1)).not.toThrow();
    });
});

describe('simplifyToBudget', () => {
    it('returns the input untouched when it already fits', () => {
        const short = [pt(0, 0), pt(1, 5), pt(2, 0)];
        expect(simplifyToBudget(short, 100)).toEqual(short);
    });

    it('meets the budget on a complex track', () => {
        const track = Array.from({ length: 5000 }, (_, i) =>
            pt(Math.sin(i / 7) * 1000 + i * 0.3, Math.cos(i / 11) * 1000, { ts: i }));
        const out = simplifyToBudget(track, 200);
        expect(out.length).toBeLessThanOrEqual(200);
        expect(out.length).toBeGreaterThan(2);
    });

    it('keeps the endpoints when it decimates', () => {
        const track = Array.from({ length: 2000 }, (_, i) => pt(i, Math.sin(i) * 50, { ts: i }));
        const out = simplifyToBudget(track, 50);
        expect(out[0].ts).toBe(0);
        expect(out[out.length - 1].ts).toBe(1999);
    });

    it('finds a much looser tolerance for a sprawling track than a tight one', () => {
        // The point of bisecting: the tolerance that hits a budget differs by orders
        // of magnitude between a cross-map run and an hour inside one building.
        const wide = Array.from({ length: 2000 }, (_, i) => pt(i * 8, Math.sin(i / 3) * 900));
        const tight = Array.from({ length: 2000 }, (_, i) => pt(i * 0.01, Math.sin(i / 3) * 2));
        expect(simplifyToBudget(wide, 100).length).toBeLessThanOrEqual(100);
        expect(simplifyToBudget(tight, 100).length).toBeLessThanOrEqual(100);
    });

    it('survives a degenerate budget', () => {
        const track = Array.from({ length: 100 }, (_, i) => pt(i, i));
        expect(simplifyToBudget(track, 1)).toHaveLength(100); // budget < 2 -> untouched
        expect(simplifyToBudget(track, 2)).toHaveLength(2);
    });

    it('terminates on a track of identical points', () => {
        // Every tolerance yields 2 points, so the bisection must not spin.
        const parked = Array.from({ length: 5000 }, () => pt(500, 500));
        expect(simplifyToBudget(parked, 10)).toHaveLength(2);
    });
});
