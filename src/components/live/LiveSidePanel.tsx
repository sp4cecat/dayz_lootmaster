import React from 'react';
import { Badge } from '@/components/base/badges/badges';
import { X, User, Car, MapPin, Flag, Wifi } from 'lucide-react';
import type { LiveEvent, LivePlayer, LiveSnapshot, LiveVehicle } from '@/types/cftools';
import type { MarkerSelection } from './LiveMarkers';
import type { CfToolsStatus } from '@/hooks/useCfToolsStatus';

interface LiveSidePanelProps {
  snapshot: LiveSnapshot | null;
  status: CfToolsStatus;
  selection: MarkerSelection | null;
  onClearSelection: () => void;
  /** P3 slot: action bar rendered under a selected player's details. */
  playerActions?: (player: LivePlayer) => React.ReactNode;
  /** Rendered below every panel state (e.g. the contextual GameLabs action panel). */
  footer?: React.ReactNode;
}

const fmtPos = (pos: [number, number, number] | null) =>
  pos ? `${Math.round(pos[0])}, ${Math.round(pos[2])}` : '—';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-900 dark:text-white text-right truncate">{children}</span>
    </div>
  );
}

function PanelHeader({ icon: Icon, title, onClear }: { icon: React.ElementType; title: string; onClear: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <div className="flex items-center gap-2 min-w-0">
        <Icon size={16} className="text-primary-600 dark:text-primary-400 shrink-0" />
        <h4 className="text-sm font-bold text-gray-900 dark:text-white truncate">{title}</h4>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        title="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
}

/**
 * Right rail of the Live Map: detail card for the selected marker, or a server
 * summary when nothing is selected. Read-only — admin actions arrive via the
 * `playerActions` slot so the panel itself stays presentational.
 */
export default function LiveSidePanel({
  snapshot, status, selection, onClearSelection, playerActions, footer,
}: LiveSidePanelProps) {
  const findPlayer = (id: string): LivePlayer | undefined =>
    snapshot?.players?.items.find(p => (p.sessionId || p.steamId || p.name) === id);
  const findVehicle = (id: string): LiveVehicle | undefined =>
    snapshot?.vehicles?.items.find((v, i) => (v.id || String(i)) === id);
  const findEvent = (kind: 'event' | 'territory', id: string): LiveEvent | undefined => {
    const layer = kind === 'event' ? snapshot?.events : snapshot?.territories;
    return layer?.items.find((e, i) => (e.id || String(i)) === id);
  };

  let body: React.ReactNode = null;

  if (selection?.kind === 'player') {
    const player = findPlayer(selection.id);
    body = player ? (
      <div>
        <PanelHeader icon={User} title={player.name} onClear={onClearSelection} />
        <Row label="Steam64">{player.steamId || '—'}</Row>
        <Row label="CFTools ID">{player.cftoolsId || '—'}</Row>
        <Row label="Position">{fmtPos(player.position)}</Row>
        <Row label="HP">{player.health != null ? `${Math.round(player.health)}` : '—'}</Row>
        <Row label="In hands">{player.handItem || '—'}</Row>
        <Row label="Ping">{player.ping != null ? `${player.ping} ms` : '—'}</Row>
        <Row label="Loaded in">{player.loaded ? 'yes' : 'still loading'}</Row>
        <Row label="Recorded bans">{player.banCount ?? '—'}</Row>
        {playerActions && <div className="mt-3">{playerActions(player)}</div>}
      </div>
    ) : (
      <p className="text-xs text-gray-400">Player left the server.</p>
    );
  } else if (selection?.kind === 'vehicle') {
    const vehicle = findVehicle(selection.id);
    body = vehicle ? (
      <div>
        <PanelHeader icon={Car} title={vehicle.displayName || vehicle.className || 'Vehicle'} onClear={onClearSelection} />
        <Row label="Class">{vehicle.className || '—'}</Row>
        <Row label="Position">{fmtPos(vehicle.position)}</Row>
        <Row label="Speed">{vehicle.speed != null ? `${Math.round(vehicle.speed)} km/h` : '—'}</Row>
        <Row label="Health">{vehicle.health != null ? `${Math.round(vehicle.health)}` : '—'}</Row>
      </div>
    ) : (
      <p className="text-xs text-gray-400">Vehicle no longer reported.</p>
    );
  } else if (selection?.kind === 'event' || selection?.kind === 'territory') {
    const event = findEvent(selection.kind, selection.id);
    const Icon = selection.kind === 'territory' ? Flag : MapPin;
    body = event ? (
      <div>
        <PanelHeader
          icon={Icon}
          title={event.displayName || event.className || event.type}
          onClear={onClearSelection}
        />
        <Row label="Type">{event.type.replace(/_/g, ' ')}</Row>
        <Row label="Class">{event.className || '—'}</Row>
        <Row label="Position">{fmtPos(event.position)}</Row>
        {event.moved !== undefined && (
          <Row label="Status">
            {event.moved ? 'moved — dropped, stored, or carried' : 'at spawn location'}
          </Row>
        )}
        {event.moved && event.spawnPosition && (
          <Row label="Spawned at">{fmtPos(event.spawnPosition)}</Row>
        )}
      </div>
    ) : (
      <p className="text-xs text-gray-400">No longer reported.</p>
    );
  } else {
    // Server summary
    const layers: { label: string; layer?: { items: unknown[]; stale?: boolean; error?: string } }[] = [
      { label: 'Players', layer: snapshot?.players },
      { label: 'Vehicles', layer: snapshot?.vehicles },
      { label: 'Events', layer: snapshot?.events },
      { label: 'Territories', layer: snapshot?.territories },
    ];
    body = (
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Wifi size={16} className="text-primary-600 dark:text-primary-400" />
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">
            {status.nickname || 'Live server'}
          </h4>
        </div>
        {layers.map(({ label, layer }) => (
          <div key={label} className="flex items-center justify-between py-1.5 border-b border-gray-100 dark:border-gray-800 last:border-0">
            <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
            {layer ? (
              <span className="flex items-center gap-1.5">
                {layer.error ? (
                  <Badge size="sm" color="warning">unavailable</Badge>
                ) : (
                  <>
                    {layer.stale && <Badge size="sm" color="warning">stale</Badge>}
                    <span className="text-xs font-medium text-gray-900 dark:text-white">{layer.items.length}</span>
                  </>
                )}
              </span>
            ) : (
              <span className="text-xs text-gray-400">off</span>
            )}
          </div>
        ))}
        <p className="mt-3 text-[11px] text-gray-400 leading-relaxed">
          Select a marker for details. Data via CF Tools Cloud{status.capabilities?.gameLabs ? ' + GameLabs' : ''}.
        </p>
      </div>
    );
  }

  return (
    <div className="w-72 shrink-0 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 p-4">
      {body}
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}
