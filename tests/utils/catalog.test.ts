import { describe, it, expect } from 'vitest';
import { normalizeTypeDetail, flattenCompatibleAttachments } from '../../src/utils/catalog.js';

describe('normalizeTypeDetail', () => {
  it('merges vanilla detail and the attachments view, preferring the attachments graph', () => {
    const detail = {
      config: { displayName: 'Kalashnikov AKM', description: 'A rugged 7.62mm rifle.' },
      compatibleAttachments: { slots: ['old'], bySlot: { old: [{ name: 'X' }] } },
      fitsInto: { slots: [], bySlot: {} },
    };
    const attachments = {
      displayName: 'AKM',
      accepts: { slots: ['weaponOpticsAK'], itemCount: 1, bySlot: { weaponOpticsAK: [{ name: 'PSO1Optic' }] } },
      fitsInto: { slots: [], objectCount: 0, bySlot: {} },
      exposesSlots: ['weaponOpticsAK'],
      occupiesSlots: [],
    };
    const out = normalizeTypeDetail('AKM', detail, attachments);
    expect(out.name).toBe('AKM');
    // attachments.displayName wins over config.displayName
    expect(out.displayName).toBe('AKM');
    // description only comes from vanilla config
    expect(out.description).toBe('A rugged 7.62mm rifle.');
    // accepts prefers the /attachments graph over compatibleAttachments
    expect(out.accepts).toBe(attachments.accepts);
    expect(out.exposesSlots).toEqual(['weaponOpticsAK']);
  });

  it('falls back to vanilla compatibleAttachments when the attachments view is missing', () => {
    const detail = {
      config: { displayName: 'Apple', description: 'A tasty apple.' },
      compatibleAttachments: { slots: [], bySlot: {} },
    };
    const out = normalizeTypeDetail('Apple', detail, null);
    expect(out.displayName).toBe('Apple');
    expect(out.description).toBe('A tasty apple.');
    expect(out.accepts).toBe(detail.compatibleAttachments);
  });

  it('handles a fully disconnected result (both upstream calls null)', () => {
    const out = normalizeTypeDetail('TTC_AK12', null, null);
    expect(out).toEqual({
      name: 'TTC_AK12',
      displayName: null,
      description: null,
      accepts: null,
      fitsInto: null,
      exposesSlots: null,
      occupiesSlots: null,
    });
  });

  it('resolves displayName from a modded class that only has the attachments view', () => {
    const attachments = { displayName: 'AK-12', accepts: null, fitsInto: null, exposesSlots: [], occupiesSlots: [] };
    const out = normalizeTypeDetail('TTC_AK12', null, attachments);
    expect(out.displayName).toBe('AK-12');
    expect(out.description).toBeNull();
  });
});

describe('flattenCompatibleAttachments', () => {
  it('flattens and de-dupes class names across every slot', () => {
    const detail = {
      accepts: {
        bySlot: {
          weaponOpticsAK: [{ name: 'PSO1Optic' }, { name: 'KobraOptic' }],
          weaponMuzzleAK: [{ name: 'AK_Suppressor' }, { name: 'PSO1Optic' }],
        },
      },
    };
    const out = flattenCompatibleAttachments(detail);
    expect(out).toEqual(['PSO1Optic', 'KobraOptic', 'AK_Suppressor']);
  });

  it('returns null when there is no attachment data (fallback to no restriction)', () => {
    expect(flattenCompatibleAttachments(null)).toBeNull();
    expect(flattenCompatibleAttachments({})).toBeNull();
    expect(flattenCompatibleAttachments({ accepts: {} })).toBeNull();
  });

  it('returns an empty array when accepts exists but exposes no items', () => {
    expect(flattenCompatibleAttachments({ accepts: { bySlot: {} } })).toEqual([]);
  });
});
