export function safeStringify(value, space) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (key, val) => {
      if (val !== null && typeof val === 'object') {
        if (seen.has(val)) {
          return undefined;
        }
        seen.add(val);
      }
      return val;
    }, space);
  } catch (err) {
    return '{}';
  }
}

export function getStoredItem(key, defaultValue) {
  try {
    const item = localStorage.getItem(key);
    if (item === null) return defaultValue;
    return JSON.parse(item);
  } catch (err) {
    console.warn(`Error reading localStorage key "${key}":`, err instanceof Error ? err.message : String(err));
    return defaultValue;
  }
}

export function setStoredItem(key, value) {
  try {
    const serialized = safeStringify(value);
    localStorage.setItem(key, serialized);
    return true;
  } catch (err) {
    console.warn(`Error writing localStorage key "${key}":`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

export function exportAllData() {
  const data = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('ag_') || key === 'ag_active_user' || key === 'ag_selected_date')) {
      data[key] = getStoredItem(key, null);
    }
  }
  return safeStringify(data, 2);
}

export function importAllData(jsonData) {
  try {
    const data = JSON.parse(jsonData);
    for (const [key, value] of Object.entries(data)) {
      if (key.startsWith('ag_')) {
        setStoredItem(key, value);
      }
    }
    return true;
  } catch (err) {
    console.warn('Failed to import JSON data:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
