import { useEffect, useMemo, useState } from 'react';
import { Button } from '../base/button/button';
import { Input } from '../base/input/input';
import { Select } from '../base/select/select';
import { Terminal } from 'lucide-react';
import { apiFetch } from '@/utils/api';
import type { useCfToolsActions } from '@/hooks/useCfToolsActions';
import ConfirmDialog from './ConfirmDialog';

type Actions = ReturnType<typeof useCfToolsActions>;

interface GameLabsActionDef {
  actionCode: string;
  actionName?: string;
  actionContext?: string;
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
      const [x = 0, y = 0, z = 0] = raw.split(/[\s,]+/).map(Number).map(n => (Number.isFinite(n) ? n : 0));
      return { dataType: 'vector', valueVectorX: x, valueVectorY: y, valueVectorZ: z };
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
 * Raw GameLabs action passthrough: pick any action the server advertises
 * (including custom mod-registered ones), fill its typed parameters, execute.
 * The escape hatch for actions Lootmaster has no dedicated UI for.
 */
export default function RawActionPanel({ actions, selectedProfileId }: {
  actions: Actions;
  selectedProfileId?: string;
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

  const selected = defs.find(d => d.actionCode === code);
  const params = useMemo(() => (selected ? paramList(selected) : []), [selected]);
  const context = selected?.actionContext || 'world';
  const needsReference = context !== 'world';

  if (defs.length === 0) return null;

  const execute = async () => {
    if (!selected) return;
    const parameters: Record<string, unknown> = {};
    for (const { key, dataType } of params) {
      parameters[key] = toWireParam(dataType, values[key] || '', !!checks[key]);
    }
    const result = await actions.gameLabsAction(
      selected.actionCode, context, needsReference ? referenceKey.trim() : null, parameters,
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
      </div>
      <Select
        size="sm"
        options={[
          { label: '— Select an action —', value: '' },
          ...defs.map(d => ({ label: d.actionName || d.actionCode, value: d.actionCode })),
        ]}
        value={code}
        onChange={e => { setCode(e.target.value); setValues({}); setChecks({}); }}
      />
      {selected && (
        <div className="space-y-2">
          {needsReference && (
            <Input
              size="sm"
              label={`Reference (${context})`}
              placeholder={context === 'player' ? 'steam64' : `${context} reference key`}
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
            disabled={actions.busy || (needsReference && !referenceKey.trim())}
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
        message={<>Run <b>{selected?.actionName || selected?.actionCode}</b>{needsReference ? <> on <b>{referenceKey}</b></> : null} on the live server?</>}
        confirmLabel="Execute"
        busy={actions.busy}
        onCancel={() => setConfirming(false)}
        onConfirm={execute}
      />
    </div>
  );
}
