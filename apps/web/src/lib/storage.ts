export function loadString(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveString(key: string, value: string | null): void {
  try {
    if (!value) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

