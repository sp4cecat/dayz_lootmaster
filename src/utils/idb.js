/**
 * Minimal IndexedDB wrapper for storing parsed types per group and file.
 * Database: dayz-types-editor
 * Object stores:
 *  - lootTypes (keyPath: "id"), records: { id: string, group: string, file: string, types: any[] }
 *  - changeLog (autoIncrement), records: { id:number, ts:number, editorID:string, group:string, file:string, typeName:string, action:'added'|'modified'|'removed' }
 */

/**
 * Open the database, creating stores if needed.
 * @returns {Promise<IDBDatabase>}
 */
export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dayz-types-editor', 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('lootTypes')) {
        const store = db.createObjectStore('lootTypes', { keyPath: 'id' });
        store.createIndex('group', 'group', { unique: false });
        store.createIndex('file', 'file', { unique: false });
      }
      if (!db.objectStoreNames.contains('changeLog')) {
        db.createObjectStore('changeLog', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Append multiple change log entries.
 * @param {{ts:number, editorID:string, group:string, file:string, typeName:string, action:'added'|'modified'|'removed'}[]} entries
 */
export async function appendChangeLogs(entries) {
  if (!entries || entries.length === 0) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('changeLog', 'readwrite');
    const store = tx.objectStore('changeLog');
    for (const e of entries) {
      store.add(e);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
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

/**
 * Clear all change log records.
 */
export async function clearChangeLog() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('changeLog', 'readwrite');
    const store = tx.objectStore('changeLog');
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Get change logs for a given group and optional set of files.
 * @param {string} group
 * @param {Set<string>=} filesLimit Set of file base names (without .xml) to include
 * @returns {Promise<{ts:number, editorID:string, group:string, file:string, typeName:string, action:'added'|'modified'|'removed'}[]>}
 */
export async function getChangeLogsForGroup(group, filesLimit) {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction('changeLog', 'readonly');
    const store = tx.objectStore('changeLog');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      const filtered = all.filter(e => e.group === group && (!filesLimit || filesLimit.has(e.file)));
      // sort by timestamp ascending
      filtered.sort((a, b) => a.ts - b.ts);
      resolve(filtered);
    };
    req.onerror = () => reject(req.error);
  });
}
