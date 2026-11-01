/** A localStorage key exposed as a useSyncExternalStore source. Local persistence only; not encrypted. */
export function createLocalStore(key: string) {
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((cb) => cb());
  return {
    key,
    subscribe(cb: () => void) {
      listeners.add(cb);
      const onStorage = (e: StorageEvent) => e.key === key && cb();
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", onStorage);
      };
    },
    /** Raw saved string, or "" when missing or storage is unavailable. */
    getSnapshot(): string {
      try {
        return window.localStorage.getItem(key) ?? "";
      } catch {
        return "";
      }
    },
    getServerSnapshot: () => "",
    /** Returns false if the browser refused the write. */
    write(value: string): boolean {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        return false;
      }
      notify();
      return true;
    },
    notify,
  };
}
