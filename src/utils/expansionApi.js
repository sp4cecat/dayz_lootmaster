// Utilities to talk to the backend server for DayZ Expansion files
// Resolves API base similarly to persistAllToFiles in App.jsx

function getApiBase() {
  const savedBase = localStorage.getItem('dayz-editor:apiBase');
  const defaultBase = `${window.location.protocol}//${window.location.hostname}:4317`;
  const base = (savedBase && savedBase.trim()) ? savedBase.trim().replace(/\/+$/,'') : defaultBase;
  return base;
}

async function httpJson(path, opts = {}) {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...opts,
    headers: {
      'Content-Type': opts.body && typeof opts.body === 'string' ? (opts.contentType || 'application/json') : (opts.headers?.['Content-Type'] || 'application/json'),
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

// Market categories
export async function listMarketFiles() {
  const data = await httpJson('/api/expansion/market');
  return data.files || [];
}
export async function getMarketFile(name) {
  return httpJson(`/api/expansion/market/${encodeURIComponent(name)}`);
}
export async function saveMarketFile(name, json) {
  const body = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  return httpJson(`/api/expansion/market/${encodeURIComponent(name)}`, { method: 'PUT', body });
}
export async function deleteMarketFile(name) {
  return httpJson(`/api/expansion/market/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// Traders (options)
export async function listTraderFiles() {
  const data = await httpJson('/api/expansion/traders');
  return data.files || [];
}
export async function getTraderFile(name) {
  return httpJson(`/api/expansion/traders/${encodeURIComponent(name)}`);
}
export async function saveTraderFile(name, json) {
  const body = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  return httpJson(`/api/expansion/traders/${encodeURIComponent(name)}`, { method: 'PUT', body });
}
export async function deleteTraderFile(name) {
  return httpJson(`/api/expansion/traders/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// Trader Zones
export async function listTraderZoneFiles() {
  const data = await httpJson('/api/expansion/traderzones');
  return data.files || [];
}
export async function getTraderZoneFile(name) {
  return httpJson(`/api/expansion/traderzones/${encodeURIComponent(name)}`);
}
export async function saveTraderZoneFile(name, json) {
  const body = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
  return httpJson(`/api/expansion/traderzones/${encodeURIComponent(name)}`, { method: 'PUT', body });
}
export async function deleteTraderZoneFile(name) {
  return httpJson(`/api/expansion/traderzones/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

// Appearance .map files
export async function listAppearanceFiles() {
  const data = await httpJson('/api/expansion/appearance');
  return data.files || [];
}
export async function getAppearanceFile(name) {
  return httpJson(`/api/expansion/appearance/${encodeURIComponent(name)}`);
}
export async function saveAppearanceFile(name, text) {
  return httpJson(`/api/expansion/appearance/${encodeURIComponent(name)}` , { method: 'PUT', body: String(text ?? ''), contentType: 'text/plain' });
}
export async function deleteAppearanceFile(name) {
  return httpJson(`/api/expansion/appearance/${encodeURIComponent(name)}`, { method: 'DELETE' });
}
