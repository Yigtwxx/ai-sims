/**
 * A boolean reported from elsewhere that a flow can wait on: the creator waits
 * for the stage to show the character it asks for before taking the thumbnail.
 */
export interface WaitFlag {
  readonly value: boolean;
  set(value: boolean): void;
  /** Resolves true once the flag is up (at once if it is), false after `ms` without it. */
  wait(ms: number): Promise<boolean>;
}

export function createWaitFlag(initial = false): WaitFlag {
  let value = initial;
  const waiters = new Set<(up: boolean) => void>();
  return {
    get value() {
      return value;
    },
    set(next) {
      value = next;
      if (!next) return;
      const ready = [...waiters];
      waiters.clear();
      for (const resolve of ready) resolve(true);
    },
    wait(ms) {
      if (value) return Promise.resolve(true);
      return new Promise((resolve) => {
        const done = (up: boolean) => {
          window.clearTimeout(timer);
          waiters.delete(done);
          resolve(up);
        };
        const timer = window.setTimeout(() => done(false), ms);
        waiters.add(done);
      });
    },
  };
}
