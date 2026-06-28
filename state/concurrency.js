const semaphores = new Map();

export function acquireConcurrency(groupId, max) {
  if (!groupId || !max || max < 1) return true;
  const cur = semaphores.get(groupId) || 0;
  if (cur >= max) return false;
  semaphores.set(groupId, cur + 1);
  return true;
}

export function releaseConcurrency(groupId) {
  if (!groupId) return;
  const cur = semaphores.get(groupId) || 0;
  semaphores.set(groupId, Math.max(0, cur - 1));
}

export function getConcurrency(groupId) {
  return semaphores.get(groupId) || 0;
}

export function resetConcurrency() {
  semaphores.clear();
}
