export type CoalescedCanonicalRefresh = {
  request: () => void;
  dispose: () => void;
};

export function createCoalescedCanonicalRefresh(
  refresh: () => void | Promise<void>,
  onError?: (cause: unknown) => void,
): CoalescedCanonicalRefresh {
  let disposed = false;
  let inFlight = false;
  let refreshQueued = false;

  const finish = () => {
    inFlight = false;
    if (disposed || !refreshQueued) return;
    refreshQueued = false;
    start();
  };

  const start = () => {
    if (disposed) return;
    inFlight = true;
    let result: void | Promise<void>;
    try {
      result = refresh();
    } catch (cause) {
      onError?.(cause);
      finish();
      return;
    }
    void Promise.resolve(result)
      .catch((cause) => onError?.(cause))
      .finally(finish);
  };

  return {
    request() {
      if (disposed) return;
      if (inFlight) {
        refreshQueued = true;
        return;
      }
      start();
    },
    dispose() {
      disposed = true;
      refreshQueued = false;
    },
  };
}
