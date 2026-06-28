class BaseStrategy {
  constructor() {
    this.usageCount = new Map();
    this.lastUsed = new Map();
  }

  recordUse(id) {
    this.lastUsed.set(id, Date.now());
    this.usageCount.set(id, (this.usageCount.get(id) || 0) + 1);
  }

  resetCount(id) {
    this.usageCount.set(id, 0);
  }

  resetSuccess(id) {
    this.usageCount.set(id, 0);
  }
}

class PriorityStrategy extends BaseStrategy {
  orderTargets(targets, ctx = {}) {
    const { stickyLimit = 1, stickyKey } = ctx;
    const stickyTargetId = stickyKey ? this.usageCount.get(`__sticky_${stickyKey}`) : null;

    return [...targets].sort((a, b) => {
      if (stickyTargetId) {
        if (a.id === stickyTargetId && (this.usageCount.get(a.id) || 0) < stickyLimit) return -1;
        if (b.id === stickyTargetId && (this.usageCount.get(b.id) || 0) < stickyLimit) return 1;
      }

      const aPriority = a.priority || 0;
      const bPriority = b.priority || 0;
      if (aPriority !== bPriority) return bPriority - aPriority;

      const aCount = this.usageCount.get(a.id) || 0;
      const bCount = this.usageCount.get(b.id) || 0;
      if (aCount !== bCount) return aCount - bCount;

      const aUsed = this.lastUsed.get(a.id) || 0;
      const bUsed = this.lastUsed.get(b.id) || 0;
      return aUsed - bUsed;
    });
  }
}

class RoundRobinStrategy extends BaseStrategy {
  orderTargets(targets, ctx = {}) {
    return [...targets].sort((a, b) => {
      const aUsed = this.lastUsed.get(a.id) || 0;
      const bUsed = this.lastUsed.get(b.id) || 0;
      if (aUsed !== bUsed) return aUsed - bUsed;
      return (a.priority || 0) - (b.priority || 0);
    });
  }
}

class WeightedStrategy extends BaseStrategy {
  orderTargets(targets, ctx = {}) {
    const totalWeight = targets.reduce((sum, t) => sum + (t.weight || 1), 0);
    let r = Math.random() * totalWeight;
    for (const t of targets.sort((a, b) => (b.priority || 0) - (a.priority || 0))) {
      r -= t.weight || 1;
      if (r <= 0) {
        return [t, ...targets.filter(x => x.id !== t.id)];
      }
    }
    return targets;
  }
}

class LeastUsedStrategy extends BaseStrategy {
  orderTargets(targets, ctx = {}) {
    return [...targets].sort((a, b) => {
      const aCount = this.usageCount.get(a.id) || 0;
      const bCount = this.usageCount.get(b.id) || 0;
      if (aCount !== bCount) return aCount - bCount;
      return (b.priority || 0) - (a.priority || 0);
    });
  }
}

class P2CStrategy extends BaseStrategy {
  orderTargets(targets, ctx = {}) {
    if (targets.length <= 1) return targets;

    const idx1 = Math.floor(Math.random() * targets.length);
    let idx2 = Math.floor(Math.random() * (targets.length - 1));
    if (idx2 >= idx1) idx2++;

    const a = targets[idx1];
    const b = targets[idx2];

    const aLoad = (this.usageCount.get(a.id) || 0) / (a.weight || 1);
    const bLoad = (this.usageCount.get(b.id) || 0) / (b.weight || 1);

    const chosen = aLoad <= bLoad ? a : b;
    return [chosen, ...targets.filter(x => x.id !== chosen.id)];
  }
}

class ResetAwareStrategy extends BaseStrategy {
  orderTargets(targets, ctx = {}) {
    const now = Date.now();
    return [...targets].sort((a, b) => {
      const aResetAt = a.resetAt || Infinity;
      const bResetAt = b.resetAt || Infinity;
      const aWait = Math.max(0, aResetAt - now);
      const bWait = Math.max(0, bResetAt - now);

      if (aWait !== bWait) return aWait - bWait;

      const aRemain = (a.rpdLimit || 1500) - (a.rpdUsed || 0);
      const bRemain = (b.rpdLimit || 1500) - (b.rpdUsed || 0);
      if (aRemain !== bRemain) return bRemain - aRemain;

      return (b.priority || 0) - (a.priority || 0);
    });
  }
}

const strategies = {
  'priority': new PriorityStrategy(),
  'round-robin': new RoundRobinStrategy(),
  'weighted': new WeightedStrategy(),
  'least-used': new LeastUsedStrategy(),
  'p2c': new P2CStrategy(),
  'reset-aware': new ResetAwareStrategy(),
};

export function createStrategy(type) {
  const strategy = strategies[type] || strategies['priority'];
  return {
    orderTargets(targets, ctx) {
      return strategy.orderTargets(targets, ctx);
    },
    recordUse(id) {
      strategy.recordUse(id);
    },
    resetSuccess(id) {
      strategy.resetSuccess(id);
    }
  };
}

export function resetAllStrategies() {
  for (const s of Object.values(strategies)) {
    s.usageCount.clear();
    s.lastUsed.clear();
  }
}
