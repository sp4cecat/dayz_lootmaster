import { useEffect, useState } from 'react';
import { quantiseNow } from '@/utils/liveWindow';

/**
 * The present, rounded up to a step boundary and re-read once per step.
 *
 * For fetch keys that must include "now" without refetching on every render: the
 * value is a stable number between ticks, so a hook keyed on it fires once per step
 * rather than once per parent render. Pauses on a hidden tab and catches up the
 * moment the tab is shown again, like the polled hooks do.
 */
export function useQuantisedNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => quantiseNow(Date.now(), stepMs));

  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      // Same value → React bails out, so a tick that lands inside the current step
      // costs nothing.
      setNow(quantiseNow(Date.now(), stepMs));
    };
    tick();
    const id = setInterval(tick, stepMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [stepMs]);

  return now;
}

export default useQuantisedNow;
