import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '../base/button/button';
import { Input } from '../base/input/input';
import { Select } from '../base/select/select';
import { Modal } from '../base/modal/modal';
import {
  Crosshair, HeartPulse, Skull, DoorOpen, MessageSquare, PackagePlus, Backpack,
} from 'lucide-react';
import { apiFetch } from '@/utils/api';
import { useCatalog } from '@/contexts/CatalogContext';
import type { LivePlayer } from '@/types/cftools';
import type { useCfToolsActions } from '@/hooks/useCfToolsActions';
import ConfirmDialog from './ConfirmDialog';

type Actions = ReturnType<typeof useCfToolsActions>;

interface LoadoutSummary {
  id: string;
  label: string;
  items: LoadoutNodeLite[];
}

interface LoadoutNodeLite {
  type?: string;
  name?: string;
  attachments?: LoadoutNodeLite[];
  cargo?: LoadoutNodeLite[];
}

/**
 * Flatten a loadout tree to the concrete classnames it contains. CF Tools'
 * spawn action cannot preserve attachment/cargo nesting, so this is a flat
 * "give me everything" test spawn — item nodes only (templates and groups
 * contribute their resolved children where present; variants are alternates
 * and are skipped).
 */
export function flattenLoadoutItems(nodes: LoadoutNodeLite[] | undefined): string[] {
  const out: string[] = [];
  const walk = (node: LoadoutNodeLite | undefined) => {
    if (!node) return;
    if ((node.type === 'item' || node.type === undefined) && node.name) out.push(node.name);
    (node.attachments || []).forEach(walk);
    (node.cargo || []).forEach(walk);
  };
  (nodes || []).forEach(walk);
  return out;
}

interface PlayerActionsBarProps {
  player: LivePlayer;
  actions: Actions;
  selectedProfileId?: string;
  /** GameLabs capability — hides engine actions when the mod isn't installed. */
  gameLabs: boolean;
  /** Ask the map to enter teleport mode for this player. */
  onStartTeleport: (player: LivePlayer) => void;
}

type DialogKind = null | 'heal' | 'kill' | 'kick' | 'message' | 'spawn-item' | 'spawn-loadout';

function ActionButton({ icon, label, onClick, disabled, danger }: {
  icon: React.ElementType; label: string; onClick: () => void; disabled?: boolean; danger?: boolean;
}) {
  return (
    <Button
      size="xs"
      variant={danger ? 'error-secondary' : 'secondary-gray'}
      icon={icon}
      onClick={onClick}
      disabled={disabled}
      className="justify-start"
    >
      {label}
    </Button>
  );
}

/**
 * Admin action bar for a selected live player. Every state-changing action is
 * confirm-gated; kill/kick use the destructive variant. GameLabs-backed
 * actions (teleport/heal/kill/spawn) hide when the capability is absent.
 */
export default function PlayerActionsBar({
  player, actions, selectedProfileId, gameLabs, onStartTeleport,
}: PlayerActionsBarProps) {
  const { displayNameFor } = useCatalog();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [kickReason, setKickReason] = useState('');
  const [messageText, setMessageText] = useState('');
  const [spawnClass, setSpawnClass] = useState('');
  const [spawnQty, setSpawnQty] = useState('1');

  const [loadouts, setLoadouts] = useState<LoadoutSummary[]>([]);
  const [loadoutId, setLoadoutId] = useState('');

  const steam64 = player.steamId;
  const canAct = !!steam64;

  // Loadout list is fetched lazily when the spawn-loadout dialog opens.
  useEffect(() => {
    if (dialog !== 'spawn-loadout' || loadouts.length > 0) return;
    (async () => {
      try {
        const res = await apiFetch('/api/loadouts', { profileId: selectedProfileId });
        const list = res.ok ? await res.json() : [];
        if (Array.isArray(list)) setLoadouts(list);
      } catch { /* dialog shows an empty select */ }
    })();
  }, [dialog, loadouts.length, selectedProfileId]);

  const selectedLoadout = loadouts.find(l => l.id === loadoutId);
  const flatItems = useMemo(
    () => flattenLoadoutItems(selectedLoadout?.items),
    [selectedLoadout],
  );

  const finish = (result: { ok: boolean; error?: string }, okMessage: string) => {
    setDialog(null);
    setFeedback(result.ok ? okMessage : (result.error || 'Action failed.'));
    setTimeout(() => setFeedback(null), 4000);
  };

  const spawnDisplayName = spawnClass.trim() ? displayNameFor(spawnClass.trim()) : undefined;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Admin actions</p>
      <div className="grid grid-cols-2 gap-1.5">
        {gameLabs && (
          <>
            <ActionButton icon={Crosshair} label="Teleport" disabled={!canAct} onClick={() => onStartTeleport(player)} />
            <ActionButton icon={HeartPulse} label="Heal" disabled={!canAct} onClick={() => setDialog('heal')} />
            <ActionButton icon={PackagePlus} label="Spawn item" disabled={!canAct} onClick={() => setDialog('spawn-item')} />
            <ActionButton icon={Backpack} label="Spawn loadout" disabled={!canAct} onClick={() => setDialog('spawn-loadout')} />
            <ActionButton icon={Skull} label="Kill" danger disabled={!canAct} onClick={() => setDialog('kill')} />
          </>
        )}
        <ActionButton icon={MessageSquare} label="Message" disabled={!player.sessionId} onClick={() => setDialog('message')} />
        <ActionButton icon={DoorOpen} label="Kick" danger disabled={!player.sessionId} onClick={() => setDialog('kick')} />
      </div>
      {feedback && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400">{feedback}</p>
      )}

      {/* Heal / Kill confirms */}
      <ConfirmDialog
        open={dialog === 'heal'}
        title="Heal player"
        message={<>Fully heal <b>{player.name}</b>?</>}
        confirmLabel="Heal"
        busy={actions.busy}
        onCancel={() => setDialog(null)}
        onConfirm={async () => finish(await actions.heal(steam64!), `Healed ${player.name}.`)}
      />
      <ConfirmDialog
        open={dialog === 'kill'}
        title="Kill player"
        destructive
        message={<>Kill <b>{player.name}</b>? They lose their character and gear.</>}
        confirmLabel="Kill player"
        busy={actions.busy}
        onCancel={() => setDialog(null)}
        onConfirm={async () => finish(await actions.kill(steam64!), `Killed ${player.name}.`)}
      />

      {/* Kick */}
      {dialog === 'kick' && (
        <Modal
          isOpen
          onClose={() => setDialog(null)}
          title={`Kick ${player.name}`}
          icon={DoorOpen}
          iconVariant="error"
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary-gray" size="sm" onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                variant="error"
                size="sm"
                disabled={actions.busy}
                onClick={async () =>
                  finish(await actions.kick(player.sessionId!, kickReason.trim() || undefined), `Kicked ${player.name}.`)}
              >
                {actions.busy ? 'Kicking…' : 'Kick player'}
              </Button>
            </>
          }
        >
          <Input
            label="Reason (shown to the player)"
            value={kickReason}
            onChange={e => setKickReason(e.target.value)}
            placeholder="Kicked by admin"
          />
        </Modal>
      )}

      {/* Private message */}
      {dialog === 'message' && (
        <Modal
          isOpen
          onClose={() => setDialog(null)}
          title={`Message ${player.name}`}
          icon={MessageSquare}
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary-gray" size="sm" onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={actions.busy || !messageText.trim()}
                onClick={async () => {
                  const result = await actions.message(messageText.trim(), player.sessionId!);
                  if (result.ok) setMessageText('');
                  finish(result, 'Message sent.');
                }}
              >
                {actions.busy ? 'Sending…' : 'Send'}
              </Button>
            </>
          }
        >
          <Input
            label="Message"
            value={messageText}
            onChange={e => setMessageText(e.target.value)}
            placeholder="Private message…"
          />
        </Modal>
      )}

      {/* Spawn item */}
      {dialog === 'spawn-item' && (
        <Modal
          isOpen
          onClose={() => setDialog(null)}
          title={`Spawn item on ${player.name}`}
          icon={PackagePlus}
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary-gray" size="sm" onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={actions.busy || !spawnClass.trim()}
                onClick={async () =>
                  finish(
                    await actions.spawnItem(steam64!, spawnClass.trim(), Math.max(1, Number(spawnQty) || 1)),
                    `Spawned ${spawnClass.trim()} on ${player.name}.`,
                  )}
              >
                {actions.busy ? 'Spawning…' : 'Spawn'}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Input
              label="Class name"
              value={spawnClass}
              onChange={e => setSpawnClass(e.target.value)}
              placeholder="e.g. M4A1"
              hint={spawnDisplayName ? `→ ${spawnDisplayName}` : undefined}
            />
            <Input
              label="Quantity"
              type="number"
              value={spawnQty}
              onChange={e => setSpawnQty(e.target.value)}
              min={1}
            />
          </div>
        </Modal>
      )}

      {/* Spawn loadout (flat) */}
      {dialog === 'spawn-loadout' && (
        <Modal
          isOpen
          onClose={() => setDialog(null)}
          title={`Spawn loadout on ${player.name}`}
          description="Items spawn as a flat list — attachment nesting is not preserved over CF Tools."
          icon={Backpack}
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="secondary-gray" size="sm" onClick={() => setDialog(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={actions.busy || flatItems.length === 0}
                onClick={async () => {
                  const result = await actions.spawnLoadout(steam64!, flatItems.map(className => ({ className })));
                  const failed = (result.results || []).filter(r => !r.ok).length;
                  finish(result, failed
                    ? `Spawned with ${failed} failure${failed === 1 ? '' : 's'}.`
                    : `Spawned ${flatItems.length} items on ${player.name}.`);
                }}
              >
                {actions.busy ? 'Spawning…' : `Spawn ${flatItems.length} items`}
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Select
              label="Loadout"
              options={[
                { label: loadouts.length ? '— Select a loadout —' : 'No loadouts found', value: '' },
                ...loadouts.map(l => ({ label: l.label, value: l.id })),
              ]}
              value={loadoutId}
              onChange={e => setLoadoutId(e.target.value)}
            />
            {selectedLoadout && (
              <p className="text-xs text-gray-500 dark:text-gray-400 max-h-32 overflow-y-auto">
                {flatItems.length ? flatItems.join(', ') : 'This loadout contains no concrete items.'}
              </p>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
