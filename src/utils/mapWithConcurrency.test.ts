import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from './mapWithConcurrency';

describe('mapWithConcurrency', () => {
    it('preserves result order regardless of completion order', async () => {
        const items = [30, 10, 20, 0, 5];
        const results = await mapWithConcurrency(items, 3, async (ms, i) => {
            await new Promise((r) => setTimeout(r, ms));
            return `${i}:${ms}`;
        });
        expect(results).toEqual(['0:30', '1:10', '2:20', '3:0', '4:5']);
    });

    it('never exceeds the concurrency limit', async () => {
        let inFlight = 0;
        let peak = 0;

        await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 6, async () => {
            inFlight += 1;
            peak = Math.max(peak, inFlight);
            await new Promise((r) => setTimeout(r, 1));
            inFlight -= 1;
        });

        expect(peak).toBeLessThanOrEqual(6);
        expect(peak).toBeGreaterThan(1);
    });

    it('visits every item exactly once', async () => {
        const seen: number[] = [];
        await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 6, async (n) => {
            seen.push(n);
        });
        expect(seen).toHaveLength(50);
        expect(new Set(seen).size).toBe(50);
    });

    it('handles an empty list', async () => {
        expect(await mapWithConcurrency([], 6, async () => 1)).toEqual([]);
    });

    it('handles fewer items than the limit', async () => {
        expect(await mapWithConcurrency([1, 2], 6, async (n) => n * 2)).toEqual([2, 4]);
    });
});
