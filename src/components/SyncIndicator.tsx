import { useEffect, useState } from 'react';
import moment from 'moment';
import { useCatalog } from '../contexts/CatalogContext';

/**
 * Very small CLE top-row indicator showing whether — and how long ago — the DayZ
 * server API companion mod last synchronised (its live snapshot heartbeat). Reads
 * connected + lastSyncAt from CatalogContext; ticks locally so the relative label
 * keeps advancing between the hook's health polls.
 */
export function SyncIndicator() {
  const { connected, lastSyncAt } = useCatalog();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  let dotClass = 'bg-gray-300 dark:bg-gray-600';
  let label = 'Server API — not synced';
  if (lastSyncAt) {
    const ago = moment(lastSyncAt).fromNow();
    if (connected) {
      dotClass = 'bg-success-500';
      label = `Server API synced ${ago}`;
    } else {
      dotClass = 'bg-warning-500';
      label = `Server API — last synced ${ago}`;
    }
  }

  return (
    <div
      className="mt-1 flex items-center gap-1.5 text-[9px] font-medium text-gray-400 dark:text-gray-500"
      title="DayZ server API synchronisation"
    >
      <span className={`size-1.5 rounded-full ${dotClass}`} />
      <span>{label}</span>
    </div>
  );
}

export default SyncIndicator;
