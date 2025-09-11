const safe = (fn, fallback) => {
  try { return fn(); } catch { return fallback; }
};

/**
 * Load JSON from localStorage.
 * @param {string} key
 * @returns {any}
 */
export function loadFromStorage(key) {
    console.log(key);
  return safe(() => JSON.parse(localStorage.getItem(key)), null);
}

/**
 * Save JSON to localStorage.
 * @param {string} key
 * @param {any} value
 */
export function saveToStorage(key, value) {
  safe(() => localStorage.setItem(key, JSON.stringify(value)));
}
