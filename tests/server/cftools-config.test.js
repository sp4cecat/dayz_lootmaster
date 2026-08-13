import { describe, it, expect, beforeEach } from 'vitest';
import {
  getAppCredentials, setAppCredentials, clearAppCredentials,
  getServerBinding, setServerBinding, redactedView, _resetState,
} from '../../server/cftools-config.js';

// Module singleton; reset between tests. Persistence is hard-disabled under
// Vitest (same guard as ingest-store), so no disk writes can occur here.
beforeEach(() => _resetState());

describe('application credentials', () => {
  it('starts unconfigured', () => {
    expect(getAppCredentials()).toBeNull();
    expect(redactedView()).toEqual({ configured: false, applicationId: null, secretSet: false });
  });

  it('stores credentials and redacts the secret', () => {
    setAppCredentials({ applicationId: 'abcdefgh12345678', secret: 'super-secret' });
    expect(getAppCredentials()).toEqual({ applicationId: 'abcdefgh12345678', secret: 'super-secret' });
    const view = redactedView();
    expect(view.configured).toBe(true);
    expect(view.secretSet).toBe(true);
    // Never leak the secret or the full application id through the redacted view.
    expect(JSON.stringify(view)).not.toContain('super-secret');
    expect(view.applicationId).toBe('abcdefgh…');
  });

  it('rejects missing fields and supports clearing', () => {
    expect(() => setAppCredentials({ applicationId: 'x' })).toThrow();
    setAppCredentials({ applicationId: 'a', secret: 'b' });
    clearAppCredentials();
    expect(getAppCredentials()).toBeNull();
  });
});

describe('server bindings', () => {
  it('binds per profile and clears on falsy apiId', () => {
    setServerBinding('profile-1', 'api-id-1', 'My Server');
    setServerBinding('profile-2', 'api-id-2', null);
    expect(getServerBinding('profile-1')).toEqual({ apiId: 'api-id-1', label: 'My Server' });
    expect(getServerBinding('profile-2')).toEqual({ apiId: 'api-id-2', label: null });
    expect(getServerBinding('profile-3')).toBeNull();

    setServerBinding('profile-1', null);
    expect(getServerBinding('profile-1')).toBeNull();
  });
});
