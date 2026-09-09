import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { beGuidFor, isSteam64 } from '../../server/be-guid.js';

/**
 * The BE GUID is md5("BE" + steam64 as 8 little-endian bytes). The reference
 * value here is computed the long way, byte by byte, so the test pins the byte
 * ORDER — the mistake that produces a well-formed GUID for the wrong player.
 */
function reference(steam64) {
    let n = BigInt(steam64);
    const bytes = [0x42, 0x45];                 // "BE"
    for (let i = 0; i < 8; i++) {
        bytes.push(Number(n & 0xffn));
        n >>= 8n;
    }
    return createHash('md5').update(Buffer.from(bytes)).digest('hex');
}

describe('beGuidFor', () => {
    it('matches the byte-by-byte little-endian construction', () => {
        for (const id of ['76561197960287930', '76561198000000001', '76561199999999999']) {
            expect(beGuidFor(id)).toBe(reference(id));
        }
    });

    it('produces 32 lowercase hex characters', () => {
        expect(beGuidFor('76561198012345678')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('is not the big-endian digest', () => {
        const id = 76561198012345678n;
        const be = Buffer.alloc(10);
        be.write('BE', 0, 'ascii');
        be.writeBigUInt64BE(id, 2);
        expect(beGuidFor(id.toString())).not.toBe(createHash('md5').update(be).digest('hex'));
    });

    it('rejects anything that is not a steam64', () => {
        expect(beGuidFor('')).toBeNull();
        expect(beGuidFor('abc')).toBeNull();
        expect(beGuidFor(Number('76561198012345678'))).toBeNull(); // numbers lose precision
        expect(isSteam64('76561198012345678')).toBe(true);
        expect(isSteam64('123')).toBe(false);
    });
});
