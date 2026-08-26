import React from 'react';
import { Badge } from '@/components/base/badges/badges';
import { X, User, Car, MapPin, Flag, Bot, Wifi } from 'lucide-react';
import { cx } from '@/utils/cx';
import type {
  LiveAi, LiveEvent, LivePlayer, LiveSnapshot, LiveTerritoryInfo, LiveTerritoryMember,
  LivePlayerRef, LiveVehicle,
} from '@/types/cftools';
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
 * Name if we have one, else the steam64, else the territory system's raw id.
 *
 * That last fallback is load-bearing rather than defensive: both BasicTerritories and
 * Expansion key members by BI GUID, and the mod resolves those to names through a
 * ledger of who has logged in. A member who has never been seen since the ledger was
 * created resolves to nothing, and showing the GUID beats showing "Unknown".
 */
const playerRefLabel = (p: LivePlayerRef | LiveTerritoryMember) =>
  p.name || p.steamId || (p as LiveTerritoryMember).id || 'Unknown';

/** Ranks (Expansion) and permissions (BasicTerritories) are alternatives, and a
 *  member may legitimately have neither. */
function memberQualifier(m: LiveTerritoryMember): string | null {
  if (m.rank) return m.rank;
  if (m.permissionNames && m.permissionNames.length) return m.permissionNames.join(', ');
  // Only reached when the mod sent a raw mask it could not decode.
  if (m.permissions != null) return `#${m.permissions}`;
  return null;
}

/**
 * Territory rows, from either the enriched GameLabs tooltip (spacecat_gamelabs) or
 * the companion mod's snapshot. Every row is conditional: the tooltip's config can
 * switch UIDs or the whole roster off, the two territory systems expose genuinely
 * different fields, and a flag on GameLabs' baseline marker yields no `territory`
 * at all. Steam64s go in `title` rather than inline so a long UID can't crowd out
 * the name.
 */
function TerritoryDetail({ info }: { info: LiveTerritoryInfo }) {
  const idLabel = info.territoryId != null
    ? `#${info.territoryId}${info.level != null ? ` · Level ${info.level}` : ''}`
    : info.level != null ? `Level ${info.level}` : null;

  const owner = info.owner as LiveTerritoryMember | null;
  // null means never scanned, which is emphatically not the same as zero — the mod
  // refreshes these on a budgeted round-robin, so a fresh flag has no counts yet.
  const hasCounts = info.objectCount != null || info.cargoCount != null;

  return (
    <>
      {owner && (
        <Row label="Owner">
          <span title={owner.steamId || owner.id || undefined}>{playerRefLabel(owner)}</span>
        </Row>
      )}
      {idLabel && <Row label="Territory">{idLabel}</Row>}
      {info.flagLevel != null && <Row label="Flag level">{`${info.flagLevel}%`}</Row>}
      {info.lifetimeHours != null && <Row label="Lifetime">{`~${info.lifetimeHours} h`}</Row>}
      {info.memberCount != null && <Row label="Members">{info.memberCount}</Row>}
      {hasCounts && (
        <Row label="Objects">
          {info.objectCount != null ? info.objectCount : '—'}
          {info.cargoCount != null && (
            <span className="text-gray-500 dark:text-gray-400">{` · ${info.cargoCount} cargo`}</span>
          )}
        </Row>
      )}

      {/* Roster excludes the owner (already shown above) and may be capped. */}
      {info.members.length > 0 && (
        <ul className="pt-1.5 space-y-1">
          {info.members.map((m, i) => (
            <li
              key={m.steamId || m.id || m.name || String(i)}
              className="flex items-center justify-between gap-2"
            >
              <span
                className={cx(
                  'text-xs truncate',
                  m.online
                    ? 'text-primary-600 dark:text-primary-400 font-medium'
                    : 'text-gray-900 dark:text-white',
                )}
                title={m.steamId || m.id || undefined}
              >
                {playerRefLabel(m)}
              </span>
              {memberQualifier(m) && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400 shrink-0 truncate max-w-[45%]">
                  {memberQualifier(m)}
                </span>
              )}
            </li>
          ))}
          {(info.membersOmitted > 0 || info.membersTruncated) && (
            <li className="text-[10px] text-gray-400 dark:text-gray-500">
              {info.membersOmitted > 0
                ? `and ${info.membersOmitted} more not shown`
                : 'roster truncated by the mod’s cap'}
            </li>
          )}
        </ul>
      )}
    </>
  );
}

/**
 * Detail for a selected AI. Read-only by design — no admin action can target an AI
 * (GameLabs player actions key on steam64, which an AI does not have), so unlike the
 * player card this one has no action bar slot.
 */
function AiDetail({ ai }: { ai: LiveAi }) {
  return (
    <>
      <Row label="Type">{ai.className || '—'}</Row>
      {ai.faction && <Row label="Faction">{ai.faction}</Row>}
      {ai.group && <Row label="Group">{ai.group}</Row>}
      <Row label="Position">{fmtPos(ai.position)}</Row>
      {ai.alive !== null && <Row label="State">{ai.alive ? 'alive' : 'dead'}</Row>}
      {ai.health != null && <Row label="Health">{Math.round(ai.health)}</Row>}
      {ai.blood != null && <Row label="Blood">{Math.round(ai.blood)}</Row>}
      {ai.shock != null && <Row label="Shock">{Math.round(ai.shock)}</Row>}
      <Row label="Hands">{ai.handItemLabel || ai.handItem || '—'}</Row>
      {/* The mod's classname heuristic is close but not authoritative, so say which
          answer this row came from rather than implying certainty. */}
      {ai.source === 'heuristic' && (
        <p className="pt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
          Identified by classname, not by the AI framework — load
          spacecat_dayz_server_api_compat_expansionai for an exact match.
        </p>
      )}
    </>
  );
}

/**
 * Shown when a territory flag carries no parsed detail, in place of the silence that
 * used to be the only symptom. The two causes need different fixes and are told apart
 * by whether the marker had a label at all:
 *
 *  - label present, unparsed — the flag is still on GameLabs' own baseline marker, so
 *    `spacecat_gamelabs_compat_expansion` is not enriching it (absent from the mod
 *    chain, ordered ahead of Expansion, or the flag has no territory registered on it).
 *  - no label — the tooltip never reached us, which is a payload-shape problem rather
 *    than a mod one. `GET /api/cftools/raw/events` reports the field names upstream
 *    actually sent.
 */
function TerritoryUnavailable({ hasLabel }: { hasLabel: boolean }) {
  return (
    <p className="pt-2 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">
      {hasLabel
        ? 'No territory detail — this flag is still on GameLabs’ own marker. Check @spacecat_gamelabs_compat_expansion is loaded and that a territory is registered on the flag.'
        : 'No territory detail — GameLabs sent no label for this flag. Check /api/cftools/raw/events for the payload shape.'}
    </p>
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
  const findAi = (id: string): LiveAi | undefined =>
    snapshot?.ai?.items.find((a, i) => (a.id || String(i)) === id);

  let body: React.ReactNode = null;

  if (selection?.kind === 'ai') {
    const ai = findAi(selection.id);
    body = ai ? (
      <div>
        <PanelHeader icon={Bot} title={ai.name} onClear={onClearSelection} />
        <AiDetail ai={ai} />
      </div>
    ) : (
      <p className="text-xs text-gray-400">No longer reported.</p>
    );
  } else if (selection?.kind === 'player') {
    const player = findPlayer(selection.id);
    body = player ? (
      <div>
        <PanelHeader icon={User} title={player.name} onClear={onClearSelection} />
        <Row label="Steam64">{player.steamId || '—'}</Row>
        <Row label="CFTools ID">{player.cftoolsId || '—'}</Row>
        <Row label="Position">{fmtPos(player.position)}</Row>
        <Row label="HP">{player.health != null ? `${Math.round(player.health)}` : '—'}</Row>
        {/* Companion-mod stats: the rows only appear once the mod supplies them,
            so a CF-Tools-only server keeps the card free of dead placeholders. */}
        {player.blood != null && <Row label="Blood">{Math.round(player.blood)}</Row>}
        {player.shock != null && <Row label="Shock">{Math.round(player.shock)}</Row>}
        {player.energy != null && <Row label="Energy">{Math.round(player.energy)}</Row>}
        {player.water != null && <Row label="Water">{Math.round(player.water)}</Row>}
        {player.alive != null && (
          <Row label="Status">
            <span className={player.alive ? undefined : 'text-error-600 dark:text-error-400'}>
              {player.alive ? 'Alive' : 'Dead'}
            </span>
          </Row>
        )}
        <Row label="In hands">{player.handItemLabel || player.handItem || '—'}</Row>
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
        {event.territory && <TerritoryDetail info={event.territory} />}
        {selection.kind === 'territory' && !event.territory && (
          <TerritoryUnavailable hasLabel={!!event.displayName} />
        )}
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
      { label: 'AI', layer: snapshot?.ai },
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
