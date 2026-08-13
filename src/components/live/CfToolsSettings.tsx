import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/base/button/button';
import { Input } from '@/components/base/input/input';
import { Select } from '@/components/base/select/select';
import { Badge } from '@/components/base/badges/badges';
import { Cloud, KeyRound, Link2 } from 'lucide-react';
import { apiFetch } from '@/utils/api';
import { useCfToolsStatus } from '@/hooks/useCfToolsStatus';

interface AppView {
  configured: boolean;
  applicationId: string | null;
  secretSet: boolean;
}

interface Grant {
  apiId: string;
  identifier: string | null;
  gameserverId: string | null;
  name: string | null;
}

const REASON_LABELS: Record<string, string> = {
  not_configured: 'Application credentials not set',
  no_api_id: 'No server linked to this profile',
  no_profile: 'No profile selected',
  auth_failed: 'CF Tools rejected the credentials',
  no_grant: 'The application has no grant for this server',
  rate_limited: 'Rate limited — retrying shortly',
  unreachable: 'CF Tools Cloud unreachable',
};

/**
 * CF Tools Cloud settings: install-wide application credentials (secret is
 * write-only — the backend never echoes it) plus the per-profile server
 * binding, picked from the application's grant list with a manual paste
 * fallback. Lives on the Profiles screen.
 */
export default function CfToolsSettings({ selectedProfileId }: { selectedProfileId: string }) {
  const { status, reload: reloadStatus } = useCfToolsStatus(selectedProfileId);

  const [app, setApp] = useState<AppView | null>(null);
  const [editingCreds, setEditingCreds] = useState(false);
  const [applicationId, setApplicationId] = useState('');
  const [secret, setSecret] = useState('');
  const [credsBusy, setCredsBusy] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);

  const [grants, setGrants] = useState<Grant[]>([]);
  const [grantsReason, setGrantsReason] = useState<string | null>(null);
  const [boundApiId, setBoundApiId] = useState('');
  const [manualApiId, setManualApiId] = useState('');
  const [bindingBusy, setBindingBusy] = useState(false);

  const loadApp = useCallback(async () => {
    try {
      const res = await apiFetch('/api/cftools/app');
      if (res.ok) setApp(await res.json());
    } catch { /* backend down; status badge already reflects it */ }
  }, []);

  const loadGrants = useCallback(async () => {
    try {
      const res = await apiFetch('/api/cftools/grants');
      const body = res.ok ? await res.json() : null;
      if (body && body.connected) {
        setGrants(body.grants || []);
        setGrantsReason(null);
      } else {
        setGrants([]);
        setGrantsReason(body?.reason || 'unreachable');
      }
    } catch {
      setGrants([]);
      setGrantsReason('unreachable');
    }
  }, []);

  const loadBinding = useCallback(async () => {
    try {
      const res = await apiFetch('/api/cftools/binding', { profileId: selectedProfileId });
      const body = res.ok ? await res.json() : null;
      setBoundApiId(body?.binding?.apiId || '');
    } catch { /* ignore */ }
  }, [selectedProfileId]);

  useEffect(() => { loadApp(); loadGrants(); }, [loadApp, loadGrants]);
  useEffect(() => { loadBinding(); }, [loadBinding]);

  const saveCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredsBusy(true);
    setCredsError(null);
    try {
      const res = await apiFetch('/api/cftools/app', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId: applicationId.trim(), secret: secret.trim() }),
      });
      const body = res.ok ? await res.json() : null;
      if (body?.ok) {
        setEditingCreds(false);
        setApplicationId('');
        setSecret('');
        await Promise.all([loadApp(), loadGrants()]);
        reloadStatus();
      } else {
        setCredsError(REASON_LABELS[body?.reason] || 'Validation failed — check the credentials.');
      }
    } catch {
      setCredsError('Backend unreachable.');
    } finally {
      setCredsBusy(false);
    }
  };

  const saveBinding = async (apiId: string) => {
    setBindingBusy(true);
    try {
      const grant = grants.find(g => g.apiId === apiId);
      const res = await apiFetch('/api/cftools/binding', {
        method: 'PUT',
        profileId: selectedProfileId,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: apiId || null, label: grant?.name || null }),
      });
      if (res.ok) {
        setBoundApiId(apiId);
        setManualApiId('');
        reloadStatus();
      }
    } catch { /* ignore */ } finally {
      setBindingBusy(false);
    }
  };

  const grantOptions = [
    { label: '— Not linked —', value: '' },
    ...grants.map(g => ({
      label: g.name ? `${g.name} (${g.apiId.slice(0, 8)}…)` : g.apiId,
      value: g.apiId,
    })),
    // Keep an unknown bound id selectable so the dropdown doesn't silently clear it.
    ...(boundApiId && !grants.some(g => g.apiId === boundApiId)
      ? [{ label: `${boundApiId} (not in grant list)`, value: boundApiId }]
      : []),
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-200 dark:bg-gray-900 dark:border-gray-800 overflow-hidden">
      <div className="p-5 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 bg-sky-600 rounded-lg flex items-center justify-center text-white shadow-sm">
            <Cloud size={22} />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">CF Tools Cloud</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Live map, admin actions and player stats via the CF Tools Data API + GameLabs.
            </p>
          </div>
        </div>
        {status.connected ? (
          <Badge color="success" size="sm">Connected{status.nickname ? ` — ${status.nickname}` : ''}</Badge>
        ) : (
          <Badge color="gray" size="sm">{REASON_LABELS[status.reason || ''] || 'Not connected'}</Badge>
        )}
      </div>

      <div className="p-5 space-y-6">
        {/* Application credentials (install-wide) */}
        <div>
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 mb-3">
            <KeyRound size={16} />
            <span className="text-sm font-semibold">Application credentials</span>
          </div>
          {!editingCreds ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {app?.configured
                  ? <>Application <span className="font-mono text-gray-700 dark:text-gray-300">{app.applicationId}</span> configured; secret stored server-side.</>
                  : <>Create an application at <span className="font-mono">developer.cftools.cloud</span>, grant it access to your server, then enter its credentials here.</>}
              </p>
              <Button size="sm" variant="secondary-gray" onClick={() => setEditingCreds(true)}>
                {app?.configured ? 'Replace' : 'Configure'}
              </Button>
            </div>
          ) : (
            <form onSubmit={saveCreds} className="space-y-3">
              <Input
                label="Application ID"
                placeholder="from developer.cftools.cloud/applications"
                value={applicationId}
                onChange={e => setApplicationId(e.target.value)}
                required
              />
              <Input
                label="Secret"
                type="password"
                placeholder="application secret (never shown again)"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                required
              />
              {credsError && <p className="text-sm text-error-600 dark:text-error-400">{credsError}</p>}
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={credsBusy}>
                  {credsBusy ? 'Validating…' : 'Save & validate'}
                </Button>
                <Button size="sm" variant="secondary-gray" onClick={() => { setEditingCreds(false); setCredsError(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Per-profile server binding */}
        {app?.configured && (
          <div>
            <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300 mb-3">
              <Link2 size={16} />
              <span className="text-sm font-semibold">Server for this profile</span>
            </div>
            {grants.length > 0 || boundApiId ? (
              <Select
                label="Granted servers"
                options={grantOptions}
                value={boundApiId}
                disabled={bindingBusy}
                onChange={e => saveBinding(e.target.value)}
                hint="Servers that granted your application access. Approve the grant in CF Tools Cloud if yours is missing."
              />
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                {grantsReason ? (REASON_LABELS[grantsReason] || 'Could not load grants.') : 'No grants found for this application.'}
              </p>
            )}
            <div className="flex items-end gap-2 mt-3">
              <Input
                label="Or paste a Server API ID"
                placeholder="24-character server api_id"
                value={manualApiId}
                onChange={e => setManualApiId(e.target.value)}
              />
              <Button
                size="sm"
                variant="secondary-gray"
                disabled={!manualApiId.trim() || bindingBusy}
                onClick={() => saveBinding(manualApiId.trim())}
              >
                Link
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
