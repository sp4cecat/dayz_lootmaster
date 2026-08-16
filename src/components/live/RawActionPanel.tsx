import { useEffect, useMemo, useState } from 'react';
import { Button } from '../base/button/button';
import { Input } from '../base/input/input';
import { Select } from '../base/select/select';
import { Terminal } from 'lucide-react';
import { apiFetch } from '@/utils/api';
import type { useCfToolsActions } from '@/hooks/useCfToolsActions';
import ConfirmDialog from './ConfirmDialog';

type Actions = ReturnType<typeof useCfToolsActions>;

/** The map selection resolved into a GameLabs action context + reference. */
export interface RawActionTarget {
  context: 'world' | 'player' | 'vehicle' | 'object';
  referenceKey: string | null;
  label: string | null;
  /** Entity classname, matched against each action's actionContextFilter allowlist. */
  className?: string | null;
}

const WORLD_TARGET: RawActionTarget = { context: 'world', referenceKey: null, label: null, className: null };

interface GameLabsActionDef {
  actionCode: string;
  actionName?: string;
  actionContext?: string;
  /** Classname allowlist: non-empty means the action only applies to these entities. */
  actionContextFilter?: string[];
  parameters?: GameLabsParamDef[] | Record<string, GameLabsParamDef>;
}

interface GameLabsParamDef {
  identifier?: string;
  name?: string;
  dataType?: string;
  type?: string;
}

// Build the GameLabs wire format for one parameter value. Strings are entered
// as-is; vectors as "x y z" (or comma separated); booleans as a checkbox.
function toWireParam(dataType: string, raw: string, checked: boolean): Record<string, unknown> {
  switch (dataType) {
    case 'int':
      return { dataType: 'int', valueInt: Math.trunc(Number(raw) || 0) };
    case 'float':
      return { dataType: 'float', valueFloat: Number(raw) || 0 };
    case 'boolean':
      return { dataType: 'boolean', valueBoolean: checked };
    case 'vector': {
      // Entered as in-game "x y z" (y = height) or just "x z". The GameLabs
      // wire order differs: valueVectorY carries world Z and valueVectorZ the
      // height (0 → snap to surface), per the mod's GetVector().
      const parts = raw.split(/[\s,]+/).filter(Boolean).map(Number).map(n => (Number.isFinite(n) ? n : 0));
      const [x = 0, y = 0, z = 0] = parts.length === 2 ? [parts[0], 0, parts[1]] : parts;
      return { dataType: 'vector', valueVectorX: x, valueVectorY: z, valueVectorZ: y };
    }
    default:
      // string, cf_itemlist, webhook_url — all carried as strings on the wire.
      return { dataType: 'string', valueString: raw };
  }
}

function paramList(def: GameLabsActionDef): { key: string; dataType: string }[] {
  const raw = def.parameters;
  if (!raw) return [];
  const entries = Array.isArray(raw)
    ? raw.map((p, i) => [p.identifier || p.name || `param${i}`, p] as const)
    : Object.entries(raw);
  return entries.map(([key, p]) => ({ key, dataType: (p && (p.dataType || p.type)) || 'string' }));
}

/**
 * Contextual GameLabs action panel: with nothing selected on the map it offers
 * only world-context actions (weather, time, "clear all AI", …); selecting a
 * player/vehicle/object marker narrows the list to that context and targets
 * the selection automatically. The escape hatch for actions Lootmaster has no
 * dedicated UI for.
 */
export default function RawActionPanel({ actions, selectedProfileId, target = WORLD_TARGET }: {
  actions: Actions;
  selectedProfileId?: string;
  target?: RawActionTarget;
}) {
  const [defs, setDefs] = useState<GameLabsActionDef[]>([]);
  const [code, setCode] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [referenceKey, setReferenceKey] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/cftools/gamelabs/actions', { profileId: selectedProfileId });
        const body = res.ok ? await res.json() : null;
        if (!cancelled && body?.connected && Array.isArray(body.actions)) setDefs(body.actions);
      } catch { /* panel stays empty */ }
    })();
    return () => { cancelled = true; };
  }, [selectedProfileId]);

  // Selecting a different marker changes the context — drop the stale pick.
  useEffect(() => {
    setCode('');
    setValues({});
    setChecks({});
  }, [target.context, target.referenceKey]);

  // Context must match, and a non-empty actionContextFilter restricts the
  // action to specific classnames (e.g. CFCloud_ScientificBriefcaseOpen only
  // applies to ScientificBriefcase).
  const available = useMemo(
    () => defs.filter(d =>
      (d.actionContext || 'world') === target.context
      && (!d.actionContextFilter?.length
        || (!!target.className && d.actionContextFilter.includes(target.className)))),
    [defs, target.context, target.className],
  );
  const selected = available.find(d => d.actionCode === code);
  const params = useMemo(() => (selected ? paramList(selected) : []), [selected]);
  const needsReference = target.context !== 'world';
  const effectiveReference = target.referenceKey ?? referenceKey.trim();

  if (defs.length === 0) return null;

  const execute = async () => {
    if (!selected) return;
    const parameters: Record<string, unknown> = {};
    for (const { key, dataType } of params) {
      parameters[key] = toWireParam(dataType, values[key] || '', !!checks[key]);
    }
    const result = await actions.gameLabsAction(
      selected.actionCode, target.context, needsReference ? effectiveReference : null, parameters,
    );
    setConfirming(false);
    setFeedback(result.ok ? `Executed ${selected.actionCode}.` : (result.error || 'Action failed.'));
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-2 border-t border-gray-200 dark:border-gray-800 pt-3">
      <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400">
        <Terminal size={13} />
        <span className="text-[10px] font-bold uppercase tracking-wider">GameLabs actions</span>
        <span className="ml-auto text-[10px] font-medium normal-case truncate max-w-40">
          {target.context === 'world' ? 'World' : `${target.context}: ${target.label || target.referenceKey}`}
        </span>
      </div>
      {available.length === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          No {target.context}-context actions available.
        </p>
      ) : (
      <Select
        size="sm"
        options={[
          { label: '— Select an action —', value: '' },
          ...available.map(d => ({ label: d.actionName || d.actionCode, value: d.actionCode })),
        ]}
        value={code}
        onChange={e => { setCode(e.target.value); setValues({}); setChecks({}); }}
      />
      )}
      {selected && (
        <div className="space-y-2">
          {needsReference && !target.referenceKey && (
            <Input
              size="sm"
              label={`Reference (${target.context})`}
              placeholder={target.context === 'player' ? 'steam64' : `${target.context} reference key`}
              value={referenceKey}
              onChange={e => setReferenceKey(e.target.value)}
            />
          )}
          {params.map(({ key, dataType }) => (
            dataType === 'boolean' ? (
              <label key={key} className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={!!checks[key]}
                  onChange={e => setChecks(c => ({ ...c, [key]: e.target.checked }))}
                />
                {key}
              </label>
            ) : (
              <Input
                key={key}
                size="sm"
                label={`${key} (${dataType})`}
                placeholder={dataType === 'vector' ? 'x y z' : dataType}
                value={values[key] || ''}
                onChange={e => setValues(v => ({ ...v, [key]: e.target.value }))}
              />
            )
          ))}
          <Button
            size="xs"
            variant="secondary-color"
            disabled={actions.busy || (needsReference && !effectiveReference)}
            onClick={() => setConfirming(true)}
          >
            Execute
          </Button>
        </div>
      )}
      {feedback && <p className="text-[11px] text-gray-500 dark:text-gray-400">{feedback}</p>}

      <ConfirmDialog
        open={confirming}
        title="Execute GameLabs action"
        message={<>Run <b>{selected?.actionName || selected?.actionCode}</b>{needsReference ? <> on <b>{target.label || effectiveReference}</b></> : null} on the live server?</>}
        confirmLabel="Execute"
        busy={actions.busy}
        onCancel={() => setConfirming(false)}
        onConfirm={execute}
      />
    </div>
  );
}
