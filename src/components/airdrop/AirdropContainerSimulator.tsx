import React, { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/base/modal/modal';
import { Button } from '@/components/base/button/button';
import { Badge } from '@/components/base/badges/badges';
import { Package, RefreshCcw01, AlertTriangle, LayersThree01, Link01 } from '@untitledui/icons';
import { cx } from '@/utils/cx';
import type { LootList, LootListLink } from '../ExpansionAirdropEditor';
import {
  containerCandidates,
  containerSelectionOdds,
  rollContainer,
  resolveLootSource,
  rollLoot,
  aggregateLootByEntry,
  type MissionInput,
  type SimSettings,
  type SimContainer,
  type SpawnedItem,
  type QuantityDisplay,
  type EntryStat,
} from '@/utils/airdropSimulator';

interface AirdropContainerSimulatorProps {
  isOpen: boolean;
  onClose: () => void;
  mission: MissionInput;
  settings: SimSettings;
  lootLists: LootList[];
  lootLinks: LootListLink[];
}

const AGGREGATE_ITERATIONS = 1000;

const pct = (p: number) => `${(p * 100).toFixed(1)}%`;

const quantityLabel = (q: QuantityDisplay): string =>
  q.kind === 'percent' ? `${q.percent}% of max` : q.kind === 'economy' ? 'random qty' : 'default qty';

// Group identical spawned items (same name + attachments + quantity) into "×N" rows so a
// 50-item crate stays readable while remaining a faithful view of one realized roll.
interface CrateGroup {
  item: SpawnedItem;
  count: number;
}
function groupCrate(items: SpawnedItem[]): CrateGroup[] {
  const map = new Map<string, CrateGroup>();
  for (const it of items) {
    const sig = `${it.name}|${it.attachments.map((a) => a.name).sort().join(',')}|${quantityLabel(it.quantity)}`;
    const existing = map.get(sig);
    if (existing) existing.count++;
    else map.set(sig, { item: it, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.item.name.localeCompare(b.item.name));
}

const SectionHeader: React.FC<{ icon: React.ElementType; title: string; hint?: React.ReactNode; children?: React.ReactNode }> = ({
  icon: Icon,
  title,
  hint,
  children,
}) => (
  <div className="flex items-start justify-between gap-3 mb-3">
    <div className="min-w-0">
      <span className="text-xs font-bold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
        <Icon size={14} /> {title}
      </span>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const WarningBanner: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-start gap-2.5 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3">
    <AlertTriangle size={18} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
    <div className="text-amber-800 dark:text-amber-200 text-xs">{children}</div>
  </div>
);

export const AirdropContainerSimulator: React.FC<AirdropContainerSimulatorProps> = ({
  isOpen,
  onClose,
  mission,
  settings,
  lootLists,
  lootLinks,
}) => {
  const missionData = useMemo(() => mission.data || {}, [mission.data]);
  const missionLabel = (missionData.MissionName || '').trim() || mission.file;

  // A mission's "unique loot" may be inline (mission.data.Loot) OR a live link to a shared
  // loot list. Resolve both so the simulator always rolls what actually deploys.
  const link = useMemo(() => lootLinks.find((l) => l.targetType === 'mission' && l.targetKey === mission.file), [lootLinks, mission.file]);
  const linkedList = useMemo(() => (link ? lootLists.find((ll) => ll.id === link.listId) : undefined), [link, lootLists]);
  const missionLoot = useMemo(() => {
    const inline = missionData.Loot ?? [];
    return inline.length > 0 ? inline : linkedList?.Loot ?? [];
  }, [missionData.Loot, linkedList]);

  // Container-lookup rules (ExpansionMissionEventAirdrop.Event_OnStart): the engine only
  // rolls a settings container when the mission's own Loot OR Infected is empty. When the
  // mission supplies both, it uses its Container as the crate verbatim (no roll) and its
  // own loot — but it STILL spawns a full crate, so we always simulate the loadout.
  const infectedEmpty = (missionData.Infected?.length ?? 0) === 0;
  const usesOwnLoot = missionLoot.length > 0;
  const selfContained = usesOwnLoot && !infectedEmpty;
  const needsLookup = !selfContained;

  // Feed the resolved loot back in so resolveLootSource / candidate matching see it.
  const effMission = useMemo(() => ({ ...missionData, Loot: missionLoot }), [missionData, missionLoot]);

  const candidates = useMemo(() => containerCandidates(effMission, settings), [effMission, settings]);
  const odds = useMemo(() => containerSelectionOdds(effMission, candidates), [effMission, candidates]);
  const noCompatibleContainer = needsLookup && candidates.length === 0;
  // A self-contained mission uses its Container verbatim as the crate — but "Random" is a
  // roll wildcard, not a real crate class, so it fails to spawn. Mirrors the editor warning.
  const invalidSelfContainedCrate =
    selfContained && String(missionData.Container ?? '').trim().toLowerCase() === 'random';

  const [chosen, setChosen] = useState<SimContainer | null>(null);
  const [crate, setCrate] = useState<SpawnedItem[]>([]);
  const [stats, setStats] = useState<EntryStat[] | null>(null);

  const resolved = useMemo(() => resolveLootSource(effMission, chosen, settings), [effMission, chosen, settings]);

  const rollAll = (container: SimContainer | null) => {
    setChosen(container);
    const r = resolveLootSource(effMission, container, settings);
    setCrate(rollLoot(r.loot, r.itemCount));
    setStats(null);
  };

  // Initial roll on mount (the component is remounted each time the modal opens).
  useEffect(() => {
    rollAll(selfContained ? null : rollContainer(effMission, candidates));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rerollContainer = () => rollAll(rollContainer(effMission, candidates));
  const rerollLoot = () => setCrate(rollLoot(resolved.loot, resolved.itemCount));
  const runAggregate = () => setStats(aggregateLootByEntry(resolved.loot, resolved.itemCount, AGGREGATE_ITERATIONS));

  const grouped = useMemo(() => groupCrate(crate), [crate]);

  // The configured loot entries, shown as a table immediately (Chance/Min/Max visible on
  // open); observed Appears/Avg fill in after Run ×N. Min = guaranteed copies, Max = copy
  // cap (-1 = unlimited), rolled by the engine's SpawnLoot copy-count logic.
  const entryRows: EntryStat[] = useMemo(
    () =>
      stats ??
      resolved.loot.map((l) => ({
        label: (l.Variants?.length ?? 0) > 0 ? `${l.Name} (+${l.Variants!.length} variant${l.Variants!.length === 1 ? '' : 's'})` : l.Name,
        chance: l.Chance ?? 1,
        min: l.Min ?? 0,
        max: l.Max ?? -1,
        frequencyPct: 0,
        avgCount: 0,
        maxObserved: 0,
      })),
    [stats, resolved.loot],
  );
  const maxLabel = (max: number) => (max < 0 ? '∞' : String(max));

  // The crate model that flies in: for a self-contained mission the engine uses the
  // mission's Container verbatim; otherwise it's the rolled settings container.
  const crateModel = selfContained ? String(missionData.Container ?? '').trim() || 'Random' : chosen?.Container ?? null;
  const lootSourceLabel = resolved.lootFromContainer
    ? `container «${chosen?.Container}»`
    : link && linkedList
      ? `this mission's linked list «${linkedList.Name}»`
      : "this mission's own loot";

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Container Simulator" icon={Package} maxWidth="max-w-4xl"
      description={`A simulated airdrop crate for «${missionLabel}» — rolled the way the Expansion mod does at runtime.`}>
      <div className="space-y-8">
        {/* ---------------------------------------------------------------- */}
        {/* 1. Loot loadout (the primary result)                              */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeader icon={LayersThree01} title="Simulated Loot Loadout"
            hint={
              resolved.loot.length === 0 ? (
                'No loot resolved for this mission.'
              ) : (
                <>
                  <span className="font-medium">{resolved.itemCount} items</span> from {lootSourceLabel}
                  {crateModel && <> · crate «{crateModel}»</>} · count inherited from {resolved.itemCountSource}
                </>
              )
            }>
            {resolved.loot.length > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="secondary-gray" icon={RefreshCcw01} onClick={rerollLoot}>Re-roll</Button>
                <Button size="sm" variant="primary" onClick={runAggregate}>Run ×{AGGREGATE_ITERATIONS.toLocaleString()}</Button>
              </div>
            )}
          </SectionHeader>

          {resolved.loot.length === 0 ? (
            <p className="text-sm text-gray-400 rounded-lg border border-gray-200 dark:border-gray-800 p-3">
              Nothing to spawn — this mission has no unique loot and no container loot resolved. Give it a loot list, or
              point it at a container with loot.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {/* Realized crate */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                  One roll — {crate.length} items ({grouped.length} unique)
                </p>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 max-h-80 overflow-auto">
                  {grouped.map((g, i) => (
                    <div key={i} className="px-3 py-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        {g.count > 1 && <Badge size="sm" color="gray">×{g.count}</Badge>}
                        <span className="text-gray-800 dark:text-gray-200 truncate">{g.item.name}</span>
                        {g.item.quantity.kind !== 'default' && (
                          <span className="text-xs text-gray-400 shrink-0">{quantityLabel(g.item.quantity)}</span>
                        )}
                      </div>
                      {g.item.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1 pl-1">
                          {g.item.attachments.map((a, j) => (
                            <Badge key={j} size="sm" color="blue">{a.name}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Per-entry copy-count table (Chance/Min/Max shown on open; Appears/Avg after Run) */}
              <div>
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                  {stats ? `Per-entry copy counts over ${AGGREGATE_ITERATIONS.toLocaleString()} rolls` : 'Loot entries — copy counts'}
                </p>
                <div className="rounded-lg border border-gray-200 dark:border-gray-800 max-h-80 overflow-auto">
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900">
                    <span className="flex-1">Entry</span>
                    <span className="w-10 text-right">Chc</span>
                    <span className="w-10 text-right">Min</span>
                    <span className="w-10 text-right">Max</span>
                    <span className="w-14 text-right">Appears</span>
                    <span className="w-12 text-right">Avg</span>
                  </div>
                  {entryRows.map((s, i) => (
                    <div key={`${s.label}-${i}`} className="flex items-center gap-2 px-3 py-1.5 text-sm border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                      <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{s.label}</span>
                      <span className="w-10 text-right tabular-nums text-gray-400">{s.chance}</span>
                      <span className={cx('w-10 text-right tabular-nums', s.min > 0 ? 'font-semibold text-primary-600 dark:text-primary-400' : 'text-gray-400')}>{s.min}</span>
                      <span className={cx('w-10 text-right tabular-nums', s.max >= 0 ? 'font-semibold text-amber-600 dark:text-amber-400' : 'text-gray-400')}>{maxLabel(s.max)}</span>
                      <span className="w-14 text-right tabular-nums text-gray-500 dark:text-gray-400">{stats ? `${s.frequencyPct.toFixed(0)}%` : '—'}</span>
                      <span className="w-12 text-right tabular-nums text-gray-500 dark:text-gray-400">{stats ? s.avgCount.toFixed(2) : '—'}</span>
                    </div>
                  ))}
                </div>
                {!stats && (
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    Run {AGGREGATE_ITERATIONS.toLocaleString()} rolls to see each entry’s appearance frequency and average copies.
                  </p>
                )}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
            <span className="font-medium text-primary-600 dark:text-primary-400">Min</span> = guaranteed copies per crate ·{' '}
            <span className="font-medium text-amber-600 dark:text-amber-400">Max</span> = copy cap (∞ = unlimited).
            Stack quantity is shown symbolically (the browser has no item-economy data to resolve absolute counts).
            Attachments spawn one level deep only, matching the engine — an attachment's own nested attachments never spawn.
          </p>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 2. Container roll                                                 */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <SectionHeader icon={Package} title="Container"
            hint={selfContained
              ? 'This mission supplies its own loot & infected, so the engine uses its Container as the crate directly (no settings-container lookup).'
              : usesOwnLoot
                ? 'Loot is the mission’s own; a settings container is still rolled to supply the crate model & infected.'
                : 'The mission inherits a settings container’s crate and loot (Usage 0/1, weighted by mission + container Weight).'}>
            {needsLookup && !noCompatibleContainer && (
              <Button size="sm" variant="secondary-gray" icon={RefreshCcw01} onClick={rerollContainer}>Roll</Button>
            )}
          </SectionHeader>

          {selfContained ? (
            invalidSelfContainedCrate ? (
              <WarningBanner>
                It supplies its own loot &amp; infected, so the engine spawns its Container as the crate directly — but{' '}
                <span className="font-medium">the Container is “Random”, which isn’t a real crate class.</span>{' '}
                Pick a specific crate class; this mission will fail when it spawns.
              </WarningBanner>
            ) : (
              <div className="flex items-center gap-2 text-sm rounded-lg border border-gray-200 dark:border-gray-800 p-3">
                <Link01 size={16} className="text-primary-500 shrink-0" />
                <span className="text-gray-600 dark:text-gray-300">
                  Crate model <span className="font-semibold">«{crateModel}»</span> · loot &amp; infected from {lootSourceLabel} ·
                  ItemCount inherits the global setting ({settings?.ItemCount ?? 0}).
                </span>
              </div>
            )
          ) : noCompatibleContainer ? (
            <WarningBanner>
              {usesOwnLoot ? 'Its Infected list is empty' : 'Its Loot list is empty'}, so it falls back to a core container,
              but{' '}
              <span className="font-medium">
                no container in Core Settings matches «{String(missionData.Container ?? '').trim() || 'Random'}» with Usage “Missions &amp; player-called” or “Only missions”.
              </span>{' '}
              This mission will fail when it spawns.
            </WarningBanner>
          ) : (
            <div className="rounded-lg border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden">
              {odds.map((o) => {
                const isChosen = chosen?.Container === o.container.Container;
                return (
                  <div key={o.container.Container}
                    className={cx('flex items-center gap-3 px-3 py-2 text-sm', isChosen && 'bg-success-50 dark:bg-success-900/20')}>
                    <span className={cx('flex-1 truncate', isChosen ? 'font-semibold text-success-700 dark:text-success-300' : 'text-gray-700 dark:text-gray-300')}>
                      {o.container.Container}
                      {isChosen && <span className="ml-1.5 text-xs text-success-600">◄ rolled</span>}
                    </span>
                    <div className="w-40 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden shrink-0">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${o.prob * 100}%` }} />
                    </div>
                    <span className="w-14 text-right tabular-nums text-gray-500 dark:text-gray-400 shrink-0">{pct(o.prob)}</span>
                    <span className="w-16 text-right tabular-nums text-xs text-gray-400 shrink-0">w {o.container.Weight ?? 0}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
};
