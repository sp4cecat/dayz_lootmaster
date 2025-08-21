/**
 * Minimal IndexedDB wrapper for storing parsed types per group and file.
 * Database: dayz-types-editor
 * Object store: lootTypes (keyPath: "id"), records: { id: string, group: string, file: string, types: any[] }
 */

/**
 * Open the database, creating stores if needed.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dayz-types-editor', 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lootTypes')) {
        const store = db.createObjectStore('lootTypes', { keyPath: 'id' });
        store.createIndex('group', 'group', { unique: false });
        store.createIndex('file', 'file', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @template T
 * @param {'readonly'|'readwrite'} mode
 * @param {(store: IDBObjectStore) => void} fn
 * @returns {Promise<void>}
 */
function withStore(mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('lootTypes', mode);
    const store = tx.objectStore('lootTypes');
    fn(store);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/**
 * Persist one types file under group and file base name.
 * @param {string} group
 * @param {string} file
 * @param {any[]} types
 */
export async function saveTypeFile(group, file, types) {
  const id = `${group}:${file}`;
  await withStore('readwrite', store => { store.put({ id, group, file, types }); });
}

/**
 * Persist many types files at once.
 * @param {{group: string, file: string, types: any[]}[]} records
 */
export async function saveManyTypeFiles(records) {
  await withStore('readwrite', store => {
    for (const r of records) {
      const id = `${r.group}:${r.file}`;
      store.put({ id, group: r.group, file: r.file, types: r.types });
    }
  });
}

/**
 * Remove all stored type files.
 */
export async function clearAllTypeFiles() {
  await withStore('readwrite', store => { store.clear(); });
}

/**
 * Load all type file records.
 * @returns {Promise<{group: string, file: string, types: any[]}[]>}
 */
export function loadAllTypeFiles() {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('lootTypes', 'readonly');
    const store = tx.objectStore('lootTypes');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}

/**
 * Load files grouped by group -> file -> types[]
 * @returns {Promise<Record<string, Record<string, any[]>>>}
 */
export async function loadAllGrouped() {
  const all = await loadAllTypeFiles();
  /** @type {Record<string, Record<string, any[]>>} */
  const out = {};
  for (const r of all) {
    if (!out[r.group]) out[r.group] = {};
    out[r.group][r.file] = r.types || [];
  }
  return out;
}
