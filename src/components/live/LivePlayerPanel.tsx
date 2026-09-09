import React, { useEffect, useState } from 'react';
import { User, Eye, EyeOff, History, Loader2 } from 'lucide-react';
import { Button } from '../base/button/button';
import { cx } from '@/utils/cx';
import { useHashRoute } from '@/hooks/useHashRoute';
import { useCfToolsPlayerStats } from '@/hooks/useCfToolsPlayerStats';
import type { SelectedPlayerHistory } from '@/hooks/useSelectedPlayerHistory';
import { HISTORY_VIEW, WINDOW_PRESETS, historyDeepLinkParams, type WindowPreset } from '@/utils/liveWindow';
import { severityChipClass, severityLabel } from '@/utils/flagSeverity';
import type { LivePlayer } from '@/types/cftools';
import type { PlayerFlag } from '@/types/history';
import ActionFeed from '../history/ActionFeed';
import InventoryPanel from '../history/InventoryPanel';
import { FlagDetail } from '../history/FlagsPanel';
import { PanelHeader, Row, fmtPos } from './LiveSidePanel';
import { livePlayerId } from './LiveMarkers';
import VitalMeters from './VitalMeters';
import NearbyPlayers from './NearbyPlayers';
import PlayerStatsBlock from './PlayerStatsBlock';

type Tab = 'overview' | 'activity' | 'loadout' | 'stats' | 'flag';

const TAB_LABELS: Record<Tab, string> = {
  overview: 'Overview', activity: 'Activity', loadout: 'Loadout', stats: 'Stats', flag: 'Flag',
};

const PRESET_LABELS: Record<WindowPreset, string> = {
  '15m': '15m', '1h': '1h', '6h': '6h', session: 'Session',
};

interface LivePlayerPanelProps {
  player: LivePlayer;
  /** Everyone online, for the nearby list. */
  players: LivePlayer[];
  hist: SelectedPlayerHistory;
  flag: PlayerFlag | null;
  /** An enforcement or dismissal changed the flag; the list should re-read. */
  onFlagChanged: () => void;
  historyAvailable: boolean;
  historyReason: string | null;
  /** The companion mod is reporting, so captures and rollbacks can reach a player. */
  modConnected: boolean;
  following: boolean;
  onToggleFollow: () => void;
  onSelectPlayer: (id: string) => void;
  onClear: () => void;
  selectedProfileId?: string;
  /** The admin action bar, built by the map (it owns the teleport gesture). */
  playerActions: React.ReactNode;
  /** The contextual GameLabs panel. */
  footer?: React.ReactNode;
}

const fmtClock = (ts: number) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** What the Session preset currently means, in words the operator can check. */
function sessionLabel(hist: SelectedPlayerHistory): string {
  if (!hist.sessionReady) return 'finding the session…';
  switch (hist.sessionKind) {
    case 'connect': return `since ${fmtClock(hist.sessionStart!)}`;
    case 'capped': return 'last 6 h — connected earlier than that';
    default: return 'last hour — this mod reports no connect events';
  }
}

function HistoryOff({ reason }: { reason: string | null }) {
  return (
    <p className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
      {reason === 'disabled'
        ? 'History recording is off. Set HISTORY_ENABLED=1 on the backend to record the companion mod’s stream.'
        : 'History is unavailable right now, so nothing recorded can be shown.'}
    </p>
  );
}

function NoSteamId() {
  return (
    <p className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
      CF Tools has not reported a Steam64 for this player yet, so nothing recorded can be matched to them.
    </p>
  );
}

/** Its own component so the CF Tools request only happens when the tab is open. */
function StatsTab({ cftoolsId, profileId }: { cftoolsId: string | null; profileId?: string }) {
  const stats = useCfToolsPlayerStats(cftoolsId, profileId);
  return <div className="px-3 py-2"><PlayerStatsBlock {...stats} /></div>;
}

/**
 * The selected live player, in the Live Map's right rail.
 *
 * Overview is the old card plus meters and neighbours; the other tabs are the
 * Player History tool's panels pointed at this one player over a session-sized
 * window. Only the open tab mounts, so the inventory list, the CF Tools stats and
 * the flag evidence are fetched when looked at, not on every selection.
 */
export default function LivePlayerPanel({
  player, players, hist, flag, onFlagChanged, historyAvailable, historyReason, modConnected,
  following, onToggleFollow, onSelectPlayer, onClear, selectedProfileId, playerActions, footer,
}: LivePlayerPanelProps) {
  const [tab, setTab] = useState<Tab>('overview');
  const id = livePlayerId(player);
  // A different player is a fresh card.
  useEffect(() => { setTab('overview'); }, [id]);

  const { navigate } = useHashRoute();

  const tabs: Tab[] = ['overview', 'activity', 'loadout', 'stats', ...(flag ? ['flag' as const] : [])];
  // The flag tab can vanish under the operator when a flag clears; fall back rather than go blank.
  const active: Tab = tab === 'flag' && !flag ? 'overview' : tab;

  const historyGate = !historyAvailable
    ? <HistoryOff reason={historyReason} />
    : !player.steamId ? <NoSteamId /> : null;

  const track = hist.tracks[0];

  return (
    <div data-testid="live-player-panel" className="flex flex-col min-h-0 flex-1">
      <div className="px-4 pt-4 pb-2 shrink-0">
        <PanelHeader icon={User} title={player.name} onClear={onClear}>
          <Button
            size="xs"
            variant={following ? 'secondary-color' : 'secondary-gray'}
            icon={following ? EyeOff : Eye}
            onClick={onToggleFollow}
            disabled={!player.position}
            title={!player.position ? 'No position yet — nothing to follow.'
              : following ? 'Stop keeping the map centred on this player.' : 'Keep the map centred on this player.'}
            aria-pressed={following}
          >
            {following ? 'Following' : 'Follow'}
          </Button>
        </PanelHeader>
        <div className="flex items-center gap-1" role="tablist">
          {tabs.map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active === t}
              onClick={() => setTab(t)}
              className={cx(
                'flex-1 px-1.5 py-1 rounded-md text-[11px] font-medium border transition-colors',
                active === t
                  ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
              )}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {active === 'overview' && (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
          <VitalMeters player={player} />
          <Row label="Steam64">{player.steamId || '—'}</Row>
          <Row label="CFTools ID">{player.cftoolsId || '—'}</Row>
          <Row label="Position">{fmtPos(player.position)}</Row>
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
          {flag && (
            <Row label="Loot cycling">
              <button
                type="button"
                onClick={() => setTab('flag')}
                className="inline-flex items-center gap-1.5"
                data-testid="loot-cycle-flag"
                title="Open the evidence"
              >
                <span className={cx('px-1.5 py-0.5 rounded-md text-[10px] font-medium border', severityChipClass(flag.severity))}>
                  {severityLabel(flag.severity)}
                </span>
                <span className="tabular-nums">{flag.score}</span>
              </button>
            </Row>
          )}
          <NearbyPlayers player={player} players={players} onSelect={onSelectPlayer} />
          <div className="mt-3">{playerActions}</div>
          {footer && <div className="mt-3">{footer}</div>}
        </div>
      )}

      {active === 'activity' && (historyGate ?? (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-3 pb-2 shrink-0 space-y-1.5">
            <div className="flex items-center gap-1" role="group" aria-label="Window">
              {WINDOW_PRESETS.map(p => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={hist.preset === p}
                  onClick={() => hist.setPreset(p)}
                  className={cx(
                    'flex-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border transition-colors',
                    hist.preset === p
                      ? 'bg-primary-50 text-primary-700 border-primary-200 dark:bg-primary-900/20 dark:text-primary-300 dark:border-primary-800'
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-400 dark:border-gray-700',
                  )}
                >
                  {PRESET_LABELS[p]}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate" data-testid="window-label">
                {hist.preset === 'session' ? sessionLabel(hist) : `last ${PRESET_LABELS[hist.preset]}`}
              </span>
              <button
                type="button"
                data-testid="open-history"
                onClick={() => navigate(HISTORY_VIEW, historyDeepLinkParams(player.steamId!, hist.from, hist.to))}
                className="inline-flex items-center gap-1 text-[11px] text-primary-600 dark:text-primary-400 hover:underline shrink-0"
                title="Open this player and window in the Player History tool"
              >
                <History size={11} /> Open in Player History
              </button>
            </div>
            <p className="text-[10px] text-gray-400 dark:text-gray-500" data-testid="path-summary">
              {hist.tracksLoading ? (
                <span className="inline-flex items-center gap-1"><Loader2 size={9} className="animate-spin" /> Loading path…</span>
              ) : hist.tracksError ? (
                <span className="text-error-600 dark:text-error-400">{hist.tracksError}</span>
              ) : track ? (
                `Path: ${track.points.length} points · ${track.runs} run${track.runs === 1 ? '' : 's'}${track.simplified ? ' · simplified' : ''}`
              ) : hist.sessionReady ? 'No recorded path in this window.' : ''}
            </p>
          </div>
          <ActionFeed
            actions={hist.actions}
            kindCounts={hist.kindCounts}
            selectedKinds={hist.kinds}
            onToggleKind={hist.toggleKind}
            onClearKinds={hist.clearKinds}
            loading={hist.actionsLoading}
            error={hist.actionsError}
            truncated={hist.truncated}
            onHoverAction={hist.setHoveredId}
          />
        </div>
      ))}

      {active === 'loadout' && (historyGate ?? (
        <InventoryPanel
          pid={player.steamId}
          name={player.name}
          from={hist.from}
          to={hist.to}
          online={player.loaded}
          modConnected={modConnected}
        />
      ))}

      {active === 'stats' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <StatsTab cftoolsId={player.cftoolsId} profileId={selectedProfileId} />
        </div>
      )}

      {active === 'flag' && flag && (
        <div className="flex-1 min-h-0 overflow-y-auto pt-2">
          <FlagDetail flag={flag} onChanged={onFlagChanged} onHoverCycle={hist.hoverCycle} />
        </div>
      )}
    </div>
  );
}
