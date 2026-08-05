// Thin wrapper around window.localStorage that swallows errors from private
// browsing mode or storage-quota limits, so a blocked/broken localStorage never
// crashes the app - it just behaves as if nothing was ever saved.

export function readStorage(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore private-mode storage errors.
  }
}

export function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore private-mode storage errors.
  }
}
