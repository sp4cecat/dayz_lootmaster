import { describe, it, expect } from 'vitest';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import PlayerStatsBlock from '../../src/components/live/PlayerStatsBlock';

// @ts-expect-error - test-only global flag not in the ambient types
global.IS_REACT_ACT_ENVIRONMENT = true;

async function render(props: React.ComponentProps<typeof PlayerStatsBlock>) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<PlayerStatsBlock {...props} />); });
  return container;
}

describe('PlayerStatsBlock', () => {
  it('renders profile and combat rows from the CF Tools payload', async () => {
    const c = await render({
      loading: false, error: null,
      omega: { playtime: 7200, sessions: 3, name_history: ['Alice', 'Alys'] },
      dayz: { kills: { players: 12, infected: 340 }, deaths: 4, kdratio: 3, longest_kill: 412.4, hits: 900 },
    });
    const text = c.textContent || '';
    expect(text).toContain('2.0 h');
    expect(text).toContain('Alice, Alys');
    expect(text).toContain('12');
    expect(text).toContain('340');
    expect(text).toContain('3.00');
    expect(text).toContain('412 m');
    // A field the server did not send is a dash, never "undefined".
    expect(text).toContain('—');
    expect(text).not.toContain('undefined');
  });

  it('shows the loading and error states instead of empty rows', async () => {
    const loading = await render({ loading: true, error: null, omega: null, dayz: null });
    expect(loading.textContent).toContain('Loading player stats');
    const failed = await render({ loading: false, error: 'Player stats unavailable.', omega: null, dayz: null });
    expect(failed.textContent).toContain('Player stats unavailable.');
    expect(failed.textContent).not.toContain('Playtime');
  });
});
