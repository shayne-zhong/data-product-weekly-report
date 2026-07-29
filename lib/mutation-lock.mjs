export function createMutationLock() {
  let tail = Promise.resolve();

  function acquire() {
    let release;
    const next = new Promise((resolve) => {
      release = resolve;
    });
    const acquired = tail.then(() => release);
    tail = tail.then(() => next);
    return acquired;
  }

  return { acquire };
}
