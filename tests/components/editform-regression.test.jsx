import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import EditForm from '../../src/components/EditForm.jsx';

describe('EditForm regression: opening edit panel must not auto-save or close', () => {
  it('does not call onSave immediately after mount', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    const definitions = {
      categories: ['tools', 'food'],
      usageflags: ['Town', 'Village'],
      valueflags: ['Tier1', 'Tier2'],
      tags: ['tagA', 'tagB'],
    };

    const selectedTypes = [
      {
        name: 'TestItem',
        category: 'tools',
        nominal: 1,
        min: 0,
        lifetime: 60,
        restock: 0,
        quantmin: -1,
        quantmax: -1,
        flags: {},
        usage: [],
        value: [],
        tag: [],
      },
    ];

    const onSave = vi.fn();
    const onCancel = vi.fn();

    root.render(
      <EditForm
        definitions={definitions}
        selectedTypes={selectedTypes}
        onCancel={onCancel}
        onSave={onSave}
        typeOptions={[]}
        typeOptionsByCategory={{}}
      />
    );

    // Allow effects to run
    await new Promise(r => setTimeout(r, 0));

    expect(onSave).not.toHaveBeenCalled();

    root.unmount();
    document.body.removeChild(container);
  });
});
