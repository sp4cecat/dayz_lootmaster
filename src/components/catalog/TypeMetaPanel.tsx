import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/base/badges/badges';
import { Info, Puzzle, PackageOpen, ChevronDown, Layers, Shield, Heart } from 'lucide-react';
import { cx } from '@/utils/cx';
import { useCatalog, type TypeDetail, type AttachmentGraph, type ArmorEntry } from '@/contexts/CatalogContext';

/**
 * Read-only info panel for a single class: displayName, description, and the
 * attachment graph. Sourced from the companion-mod catalog; shows a "not
 * connected" hint when the mod isn't live or the class is unknown.
 *
 * `graphs` selects which attachment directions to render:
 *  - 'accepts'  — what attaches ONTO this item (shown on the Loot Economy tab)
 *  - 'fitsInto' — what this item attaches onto (shown on the Spawnable / Cargo tab)
 */
export function TypeMetaPanel({
  name,
  className,
  graphs = ['accepts', 'fitsInto'],
}: {
  name?: string;
  className?: string;
  graphs?: ('accepts' | 'fitsInto')[];
}) {
  const { connected, getTypeDetail, displayNameFor } = useCatalog();
  const [detail, setDetail] = useState<TypeDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!name) { setDetail(null); return; }
    setLoading(true);
    getTypeDetail(name).then(d => {
      if (!cancelled) { setDetail(d); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [name, getTypeDetail]);

  if (!name) return null;

  const showAccepts = graphs.includes('accepts');
  const showFitsInto = graphs.includes('fitsInto');

  const hasGraph = (g: AttachmentGraph | null | undefined) =>
    !!g && !!g.bySlot && Object.keys(g.bySlot).length > 0;

  const hasMagazines = !!detail && Array.isArray(detail.magazines) && detail.magazines.length > 0;
  const hasHitpoints = !!detail && typeof detail.hitpoints === 'number' && detail.hitpoints > 0;
  // Only rows with at least one declared zone (a value other than -1) are worth showing.
  const armorRows = (detail?.armor ?? []).filter(a => a.health > -1 || a.blood > -1 || a.shock > -1);
  const hasArmor = armorRows.length > 0;

  const empty = !detail || (
    !detail.displayName && !detail.description &&
    !(showAccepts && hasGraph(detail.accepts)) &&
    !(showFitsInto && hasGraph(detail.fitsInto)) &&
    !hasMagazines && !hasHitpoints && !hasArmor
  );

  return (
    <section className={className}>
      <div className="flex items-center gap-2 mb-3">
        <Badge color="gray" size="sm" type="modern">Catalog Detail</Badge>
        {!connected && (
          <span className="text-[11px] text-gray-400">mod not connected</span>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/40 p-4 space-y-4">
        {loading && !detail ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : empty ? (
          <p className="text-xs text-gray-400 flex items-center gap-1.5">
            <Info size={13} />
            {connected ? 'No catalog metadata for this class.' : 'Companion mod not connected.'}
          </p>
        ) : (
          <>
            {detail!.displayName && (
              <div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">{detail!.displayName}</p>
                <p className="text-[11px] font-mono text-gray-400">{detail!.name}</p>
              </div>
            )}
            {detail!.description && (
              <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{detail!.description}</p>
            )}
            {showAccepts && hasGraph(detail!.accepts) && (
              <AttachmentList
                icon={<Puzzle size={13} />}
                label="Accepts (attaches onto this)"
                graph={detail!.accepts!}
              />
            )}
            {showFitsInto && hasGraph(detail!.fitsInto) && (
              <AttachmentList
                icon={<PackageOpen size={13} />}
                label="Fits into (this attaches onto)"
                graph={detail!.fitsInto!}
              />
            )}
            {hasMagazines && (
              <MagazineList
                classes={detail!.magazines!}
                labelFor={(cls) => displayNameFor(cls) || cls}
              />
            )}
            {hasHitpoints && (
              <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                <Heart size={13} className="text-rose-500" />
                <span className="font-bold uppercase tracking-wider">Durability</span>
                <span className="ml-1 font-mono text-gray-700 dark:text-gray-200">{detail!.hitpoints} HP</span>
              </div>
            )}
            {hasArmor && (
              <ArmorTable rows={armorRows} labelFor={(cls) => displayNameFor(cls) || cls} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Collapsible list of the compatible magazine classes for a weapon, default closed. */
function MagazineList({ classes, labelFor }: { classes: string[]; labelFor: (cls: string) => string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-950/30">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
      >
        <ChevronDown size={14} className={cx('transition-transform text-gray-400', !open && '-rotate-90')} />
        <Layers size={13} /> Magazines (accepts)
        <span className="ml-1 px-1.5 py-0.5 text-[10px] normal-case bg-gray-100 text-gray-600 rounded-full dark:bg-gray-800 dark:text-gray-300">
          {classes.length}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 animate-in slide-in-from-top-1 duration-200">
          <div className="flex flex-wrap gap-1">
            {classes.map(cls => (
              <span
                key={cls}
                title={cls}
                className="inline-flex items-center rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-200"
              >
                {labelFor(cls)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Collapsible GlobalArmor table: one row per damage-type, columns for the health /
 * blood / shock zones. The value is how much that type DEALS to the zone
 * (0 = immune, higher = less protection); an undeclared zone (-1) shows as "—".
 */
function ArmorTable({ rows, labelFor }: { rows: ArmorEntry[]; labelFor: (ammo: string) => string }) {
  const [open, setOpen] = useState(false);

  const cell = (v: number) => {
    if (v <= -1) return <span className="text-gray-300 dark:text-gray-600">—</span>;
    if (v === 0) return <span className="text-emerald-600 dark:text-emerald-400 font-semibold" title="Immune">0</span>;
    return <span className="text-gray-700 dark:text-gray-200">{v}</span>;
  };

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-950/30">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
      >
        <ChevronDown size={14} className={cx('transition-transform text-gray-400', !open && '-rotate-90')} />
        <Shield size={13} /> Armor (damage taken)
        <span className="ml-1 px-1.5 py-0.5 text-[10px] normal-case bg-gray-100 text-gray-600 rounded-full dark:bg-gray-800 dark:text-gray-300">
          {rows.length}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 animate-in slide-in-from-top-1 duration-200">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th className="font-medium py-1 pr-2">Damage type</th>
                <th className="font-medium py-1 px-2 text-right">Health</th>
                <th className="font-medium py-1 px-2 text-right">Blood</th>
                <th className="font-medium py-1 pl-2 text-right">Shock</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ammo} className="border-t border-gray-100 dark:border-gray-800/60">
                  <td className="py-1 pr-2 font-mono text-gray-600 dark:text-gray-300 truncate" title={r.ammo}>
                    {labelFor(r.ammo)}
                  </td>
                  <td className="py-1 px-2 text-right font-mono">{cell(r.health)}</td>
                  <td className="py-1 px-2 text-right font-mono">{cell(r.blood)}</td>
                  <td className="py-1 pl-2 text-right font-mono">{cell(r.shock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Collapsible list of one attachment direction, default closed. */
function AttachmentList({ icon, label, graph }: { icon: React.ReactNode; label: string; graph: AttachmentGraph }) {
  const [open, setOpen] = useState(false);
  const count = useMemo(
    () => Object.values(graph.bySlot).reduce((sum, refs) => sum + (refs?.length || 0), 0),
    [graph],
  );

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-950/30">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
      >
        <ChevronDown size={14} className={cx('transition-transform text-gray-400', !open && '-rotate-90')} />
        {icon} {label}
        <span className="ml-1 px-1.5 py-0.5 text-[10px] normal-case bg-gray-100 text-gray-600 rounded-full dark:bg-gray-800 dark:text-gray-300">
          {count}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 animate-in slide-in-from-top-1 duration-200">
          {Object.entries(graph.bySlot).map(([slot, refs]) => (
            <div key={slot}>
              <p className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">{slot}</p>
              <div className="flex flex-wrap gap-1">
                {refs.map(ref => (
                  <span
                    key={ref.name}
                    title={ref.displayName || ref.name}
                    className="inline-flex items-center rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 px-1.5 py-0.5 text-[11px] text-gray-700 dark:text-gray-200"
                  >
                    {ref.displayName || ref.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
