import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, AlertTriangle, Plus, Trash2, ShieldAlert } from 'lucide-react';
import { Modal } from '../base/modal/modal';
import { Button } from '../base/button/button';
import { Badge } from '../base/badges/badges';
import { Input } from '../base/input/input';
import { Select } from '../base/select/select';
import { Toggle } from '../base/toggle/toggle';
import { Checkbox } from '../base/checkbox/checkbox';
import { apiFetch } from '@/utils/api';
import { cx } from '@/utils/cx';
import type { LadderRung, LootCyclePolicy, LootCyclePolicyUpdate } from '@/types/history';

const SEVERITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
];

const ACTION_OPTIONS: { label: string; value: LadderRung['action'] }[] = [
  { label: 'Notice', value: 'notice' },
  { label: 'Warning', value: 'warning' },
  { label: 'Kick', value: 'kick' },
  { label: 'Temp ban', value: 'tempban' },
];

const WEBHOOK_SEVERITY_OPTIONS = [
  { label: 'Medium and above', value: 'medium' },
  { label: 'High and above', value: 'high' },
  { label: 'Critical only', value: 'critical' },
];

/** What the operator is editing, kept apart from the wire policy until Save. */
interface Draft {
  enabled: boolean;
  profileId: string;
  ladder: LadderRung[];
  cooldownMin: number;
  webhookUrl: string;
  clearWebhook: boolean;
  minSeverity: string;
}

function toDraft(p: LootCyclePolicy): Draft {
  return {
    enabled: p.enabled,
    profileId: p.profileId ?? '',
    ladder: p.ladder.map(r => ({ ...r })),
    cooldownMin: Math.round(p.cooldownMs / 60_000),
    webhookUrl: '',
    clearWebhook: false,
    minSeverity: p.webhook.minSeverity,
  };
}

/**
 * The profiles the CF Tools binding can resolve through.
 *
 * Read directly rather than plumbed from App: this modal opens three levels
 * down from the view that has the list, and the list is small and static.
 */
function useProfileList(open: boolean) {
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/profiles');
        const body = res.ok ? await res.json() : null;
        if (!cancelled && Array.isArray(body)) {
          setProfiles(body.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
        }
      } catch {
        if (!cancelled) setProfiles([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);
  return profiles;
}

/** Everything wrong with the draft, or null. Mirrors what the backend refuses. */
function validate(d: Draft): string | null {
  if (!Number.isFinite(d.cooldownMin) || d.cooldownMin < 0) return 'Cooldown must be zero or more minutes.';
  for (const r of d.ladder) {
    if ((r.action === 'notice' || r.action === 'warning') && !r.text.trim()) {
      return `Rung ${r.rung} sends a message but has no text.`;
    }
    if (r.action === 'tempban' && !(r.minutes && r.minutes > 0)) {
      return `Rung ${r.rung} is a temp ban with no duration.`;
    }
  }
  if (d.webhookUrl.trim() && !/^https:\/\/(discord(app)?\.com)\/api\/webhooks\//i.test(d.webhookUrl.trim())) {
    return 'The webhook URL should be a Discord webhook (https://discord.com/api/webhooks/…).';
  }
  return null;
}

interface LootCyclePolicyModalProps {
  open: boolean;
  onClose: () => void;
  policy: LootCyclePolicy | null;
  loading: boolean;
  error: string | null;
  save: (partial: LootCyclePolicyUpdate) => Promise<boolean>;
}

/**
 * The loot-cycle policy editor: whether the detector runs, the escalation ladder,
 * the cooldown between messages, the Discord webhook and the CF Tools profile.
 *
 * The webhook URL is write-only. The backend redacts it to `set: true`, so the
 * field here starts empty, a typed value replaces the stored one, and "Clear"
 * sends an explicit null — leaving the field blank changes nothing.
 */
export default function LootCyclePolicyModal({
  open, onClose, policy, loading, error, save,
}: LootCyclePolicyModalProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const profiles = useProfileList(open);

  // Re-seed on every open so a stale draft from last time never survives; the
  // policy can also arrive after the modal does, so seed on that too.
  useEffect(() => {
    if (!open) { setDraft(null); setFormError(null); return; }
    if (policy) setDraft(toDraft(policy));
  }, [open, policy]);

  const patch = useCallback((p: Partial<Draft>) => setDraft(d => (d ? { ...d, ...p } : d)), []);

  const patchRung = useCallback((index: number, p: Partial<LadderRung>) => {
    setDraft(d => {
      if (!d) return d;
      const ladder = d.ladder.map((r, i) => (i === index ? { ...r, ...p } : r));
      return { ...d, ladder };
    });
  }, []);

  const removeRung = useCallback((index: number) => {
    setDraft(d => d ? {
      ...d,
      ladder: d.ladder.filter((_, i) => i !== index).map((r, i) => ({ ...r, rung: i + 1 })),
    } : d);
  }, []);

  const addRung = useCallback(() => {
    setDraft(d => d ? {
      ...d,
      ladder: [...d.ladder, { rung: d.ladder.length + 1, severity: 'high', action: 'warning', text: '', auto: false }],
    } : d);
  }, []);

  const profileOptions = useMemo(() => [
    { label: '— none (messages only, no kick or ban) —', value: '' },
    ...profiles.map(p => ({ label: p.name, value: p.id })),
  ], [profiles]);

  const onSave = useCallback(async () => {
    if (!draft) return;
    const problem = validate(draft);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    setBusy(true);
    const url = draft.webhookUrl.trim();
    const update: LootCyclePolicyUpdate = {
      enabled: draft.enabled,
      profileId: draft.profileId || null,
      ladder: draft.ladder.map((r, i) => ({
        ...r,
        rung: i + 1,
        text: r.text.trim(),
        // A duration only means something on a ban; drop it elsewhere so the
        // stored ladder does not carry a stray "minutes" on a notice.
        minutes: r.action === 'tempban' ? r.minutes : undefined,
      })),
      cooldownMs: Math.round(draft.cooldownMin * 60_000),
      webhook: {
        minSeverity: draft.minSeverity,
        ...(draft.clearWebhook ? { url: null } : url ? { url } : {}),
      },
    };
    const ok = await save(update);
    setBusy(false);
    if (ok) onClose();
  }, [draft, save, onClose]);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Loot-cycle policy"
      description="What the detector does when a player's pickups and drops start looking like loot cycling."
      icon={ShieldAlert}
      iconVariant="warning"
      maxWidth="max-w-3xl"
      footer={
        <>
          <Button variant="secondary-gray" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={busy || !draft}>
            {busy ? 'Saving…' : 'Save policy'}
          </Button>
        </>
      }
    >
      {loading && !draft && (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" /> Loading policy…
        </div>
      )}

      {(error || formError) && (
        <div className="mb-4 p-3 bg-error-50 border border-error-200 rounded-lg text-sm text-error-700 flex items-start gap-2 dark:bg-error-900/20 dark:border-error-800 dark:text-error-400">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>{formError ?? error}</span>
        </div>
      )}

      {draft && (
        <div className="space-y-6">
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-3">
              <Toggle
                label="Detector enabled"
                hint="Scores the recorded action log every 30 s and keeps flags up to date."
                isSelected={draft.enabled}
                onChange={(v) => patch({ enabled: v })}
              />
              <Input
                label="Cooldown between messages (minutes)"
                type="number"
                min={0}
                size="sm"
                value={String(draft.cooldownMin)}
                onChange={(e) => patch({ cooldownMin: Number(e.target.value) })}
                hint="The least time between two messages to the same player."
              />
            </div>
            <Select
              label="CF Tools profile"
              size="sm"
              options={profileOptions}
              value={draft.profileId}
              onChange={(e) => patch({ profileId: e.target.value })}
              hint="Kicks fall back to CF Tools when the mod is offline; temp bans need it. Messages go through the mod."
            />
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Escalation ladder</h4>
              <Button size="sm" variant="secondary-gray" icon={Plus} onClick={addRung}>Add rung</Button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              Rungs fire in order, once per episode. Automatic rungs fire on their own when the
              severity is reached; manual ones appear as buttons on the flag. The runner never
              skips a manual rung to reach an automatic one above it.
            </p>
            <div className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs border-collapse">
                <thead className="bg-gray-50 dark:bg-gray-900/80 border-b border-gray-200 dark:border-gray-800 text-left">
                  <tr className="text-gray-600 dark:text-gray-400">
                    <th className="px-2 py-2 font-semibold w-8">#</th>
                    <th className="px-2 py-2 font-semibold w-28">Severity</th>
                    <th className="px-2 py-2 font-semibold w-28">Action</th>
                    <th className="px-2 py-2 font-semibold">Message / reason</th>
                    <th className="px-2 py-2 font-semibold w-14 text-center">Auto</th>
                    <th className="px-2 py-2 font-semibold w-20">Minutes</th>
                    <th className="px-2 py-2 w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800 bg-white dark:bg-gray-950">
                  {draft.ladder.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-center text-gray-500 italic">
                        No rungs: the detector flags players but never acts on its own.
                      </td>
                    </tr>
                  )}
                  {draft.ladder.map((r, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-2 py-2 tabular-nums text-gray-500">{i + 1}</td>
                      <td className="px-2 py-2">
                        <Select
                          size="sm"
                          aria-label={`Rung ${i + 1} severity`}
                          options={SEVERITY_OPTIONS}
                          value={r.severity}
                          onChange={(e) => patchRung(i, { severity: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          size="sm"
                          aria-label={`Rung ${i + 1} action`}
                          options={ACTION_OPTIONS}
                          value={r.action}
                          onChange={(e) => patchRung(i, {
                            action: e.target.value as LadderRung['action'],
                            minutes: e.target.value === 'tempban' ? (r.minutes ?? 1440) : r.minutes,
                          })}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <Input
                          size="sm"
                          aria-label={`Rung ${i + 1} text`}
                          placeholder={r.action === 'kick' || r.action === 'tempban' ? 'Reason shown to the player' : 'Message shown in-game'}
                          value={r.text}
                          onChange={(e) => patchRung(i, { text: e.target.value })}
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Checkbox
                          aria-label={`Rung ${i + 1} automatic`}
                          isSelected={r.auto}
                          onChange={(v) => patchRung(i, { auto: v })}
                          className="justify-center"
                        />
                      </td>
                      <td className="px-2 py-2">
                        {r.action === 'tempban' ? (
                          <Input
                            size="sm"
                            type="number"
                            min={1}
                            aria-label={`Rung ${i + 1} ban minutes`}
                            value={String(r.minutes ?? '')}
                            onChange={(e) => patchRung(i, { minutes: Number(e.target.value) || undefined })}
                          />
                        ) : (
                          <span className="text-gray-300 dark:text-gray-600">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          onClick={() => removeRung(i)}
                          title="Remove this rung"
                          aria-label={`Remove rung ${i + 1}`}
                          className="p-1 rounded-md text-gray-400 hover:text-error-600 hover:bg-error-50 dark:hover:text-error-400 dark:hover:bg-error-900/20"
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Discord webhook</label>
                {policy?.webhook.set && !draft.clearWebhook && <Badge size="sm" color="success">set</Badge>}
                {draft.clearWebhook && <Badge size="sm" color="warning">will be cleared</Badge>}
              </div>
              <Input
                size="sm"
                type="url"
                placeholder={policy?.webhook.set ? 'Leave blank to keep the stored URL' : 'https://discord.com/api/webhooks/…'}
                value={draft.webhookUrl}
                disabled={draft.clearWebhook}
                onChange={(e) => patch({ webhookUrl: e.target.value })}
                hint="Write-only: the stored URL is never shown again."
              />
              {policy?.webhook.set && (
                <button
                  type="button"
                  onClick={() => patch({ clearWebhook: !draft.clearWebhook, webhookUrl: '' })}
                  className={cx(
                    'mt-1.5 text-xs',
                    draft.clearWebhook
                      ? 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                      : 'text-error-600 hover:text-error-700 dark:text-error-400',
                  )}
                >
                  {draft.clearWebhook ? 'Keep the stored webhook' : 'Clear the stored webhook'}
                </button>
              )}
            </div>
            <Select
              label="Post to Discord for"
              size="sm"
              options={WEBHOOK_SEVERITY_OPTIONS}
              value={draft.minSeverity}
              onChange={(e) => patch({ minSeverity: e.target.value })}
              hint="Also posts on every automatic enforcement, whatever the band."
            />
          </section>
        </div>
      )}
    </Modal>
  );
}
