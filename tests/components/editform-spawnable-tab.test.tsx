import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import EditFormSpawnableTab from '../../src/components/EditFormSpawnableTab';
import { XMLNodeKind } from '../../src/types/xml';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

// Mock dependencies if needed
vi.mock('@/utils/xml', async () => {
  const actual = await vi.importActual('@/utils/xml');
  return {
    ...actual,
    findSpawnableEntryForType: vi.fn(),
  };
});

import { findSpawnableEntryForType } from '@/utils/xml';

describe('EditFormSpawnableTab', () => {
  const defaultProps = {
    selectedTypes: [{ name: 'TestItem', group: 'vanilla' }] as any,
    spawnableTypesByGroup: {},
    setSpawnableTypesByGroup: vi.fn(),
    randomPresets: { presets: [] },
    globalsDefaults: { LootDamageMin: 0.1, LootDamageMax: 0.8 },
    typeOptions: [],
  };

  async function renderComponent(props = defaultProps) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<EditFormSpawnableTab {...props} />);
    });
    return {
      container,
      unmount: () => {
        root.unmount();
        document.body.removeChild(container);
      }
    };
  }

  it('renders "Set Spawn Damage" button when no damage section exists', async () => {
    (findSpawnableEntryForType as any).mockReturnValue(null); // Virtual entry

    const { container, unmount } = await renderComponent();

    expect(container.textContent).toContain('Set Spawn Damage');
    expect(container.textContent).not.toContain('Min Damage');
    unmount();
  });

  it('renders sliders when damage section exists', async () => {
    (findSpawnableEntryForType as any).mockReturnValue({
      group: 'vanilla',
      entry: {
        name: 'TestItem',
        sections: [
          {
            kind: XMLNodeKind.DAMAGE,
            attrs: { min: '0.2', max: '0.5' },
          },
        ],
        damage: { min: 0.2, max: 0.5 },
      },
    });

    const { container, unmount } = await renderComponent();

    expect(container.textContent).not.toContain('Set Spawn Damage');
    expect(container.textContent).toContain('Min Damage');
    expect(container.textContent).toContain('Max Damage');
    unmount();
  });

  it('adds damage section when clicking "Set Spawn Damage"', async () => {
    (findSpawnableEntryForType as any).mockReturnValue(null);

    const { container, unmount } = await renderComponent();

    const button = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Set Spawn Damage');
    expect(button).toBeDefined();
    
    await act(async () => {
      button?.click();
    });

    expect(defaultProps.setSpawnableTypesByGroup).toHaveBeenCalled();
    const nextGroups = defaultProps.setSpawnableTypesByGroup.mock.calls[0][0];
    // spawnableTypesByGroup is nested per group -> per file -> { types }. A vanilla-group
    // item writes to the mission root's cfgspawnabletypes.xml.
    const entry = nextGroups['__root']['cfgspawnabletypes.xml'].types[0];
    expect(entry.sections.some((s: any) => s.kind === XMLNodeKind.DAMAGE)).toBe(true);
    unmount();
  });
});
