import { useMemo } from 'react';
import { Users } from 'lucide-react';
import { NEARBY_RADIUS_M } from '@/utils/liveWindow';
import { compassPoint, distanceBearing, formatDistance } from '@/utils/mapGeo';
import type { LivePlayer } from '@/types/cftools';
import { livePlayerId } from './LiveMarkers';

interface NearbyPlayersProps {
  player: LivePlayer;
  players: LivePlayer[];
  radiusM?: number;
  onSelect: (id: string) => void;
}

/**
 * Other connected players within `radiusM` of the selected one, nearest first,
 * each with distance and bearing FROM the selected player. Click one to select
 * it — the quickest way to walk a fight or a trade.
 */
export default function NearbyPlayers({ player, players, radiusM = NEARBY_RADIUS_M, onSelect }: NearbyPlayersProps) {
  const selfId = livePlayerId(player);
  const near = useMemo(() => {
    if (!player.position) return [];
    const from = { x: player.position[0], z: player.position[2] };
    return players
      .filter(p => p.position && livePlayerId(p) !== selfId)
      .map((p) => {
        const d = distanceBearing(from, { x: p.position![0], z: p.position![2] });
        return { p, ...d };
      })
      .filter(r => r.metres <= radiusM)
      .sort((a, b) => a.metres - b.metres);
  }, [player.position, players, selfId, radiusM]);

  return (
    <div data-testid="nearby-players" className="pt-2">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
        <Users size={11} /> Nearby
        <span className="font-medium normal-case tracking-normal">(within {formatDistance(radiusM)})</span>
      </p>
      {!player.position ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 pt-1">No position yet.</p>
      ) : near.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 pt-1">No one within {formatDistance(radiusM)}.</p>
      ) : (
        <ul className="pt-1">
          {near.map(({ p, metres, bearingDeg }) => (
            <li key={livePlayerId(p)}>
              <button
                type="button"
                onClick={() => onSelect(livePlayerId(p))}
                className="w-full flex items-center justify-between gap-2 py-1 text-left hover:text-primary-600 dark:hover:text-primary-400"
              >
                <span className="text-xs text-gray-900 dark:text-white truncate">{p.name}</span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums shrink-0">
                  {formatDistance(metres)} · {Math.round(bearingDeg)}° {compassPoint(bearingDeg)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
