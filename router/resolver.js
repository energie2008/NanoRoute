import { getBridgeCandidates } from './capability-graph.js';

export class Resolver {
  constructor(config) {
    this.config = config;
    this.providerMap = new Map();
    this.groupMap = config._groupMap || new Map();
    this.comboMap = new Map();
    this._rrCounters = new Map();
    this._bridgeEnabled = config.routing?.capability_bridge !== false;
    this._bridgeLog = [];

    for (const p of config.providers) {
      if (p.enabled !== false) {
        this.providerMap.set(p.id, p);
      }
    }

    for (const combo of (config.combos || [])) {
      this.comboMap.set(combo.id, combo);
    }
  }
  
  resolve(modelName) {
    const aliasTarget = this.config.aliases?.[modelName];
    const resolvedName = aliasTarget || modelName;

    const combo = this.comboMap.get(resolvedName);
    if (combo) {
      if (combo.strategy === 'fusion') {
        return { memberGroups: [], combo, strategy: 'fusion' };
      }
      const orderedMembers = this._selectMembersOrdered(combo);
      const memberGroups = orderedMembers.map(m => ({
        refId: m.group,
        targets: this._getMemberTargets(m.group),
        weight: m.weight || 1
      })).filter(g => g.targets.length > 0);
      
      if (memberGroups.length === 0) {
        throw new Error(`Combo ${combo.id} has no valid members`);
      }
      
      if (combo.strategy === 'fastest') {
        return { memberGroups, combo, strategy: 'fastest' };
      }
      
      return { memberGroups, combo, strategy: combo.strategy || 'fallback' };
    }

    if (this.groupMap.has(resolvedName)) {
      const group = this.groupMap.get(resolvedName);
      const targets = group.providers.filter(p => p.enabled !== false);
      return { memberGroups: [{ refId: resolvedName, targets }], combo: null };
    }

    const provider = this.providerMap.get(resolvedName);
    if (provider) {
      return { memberGroups: [{ refId: resolvedName, targets: [provider] }], combo: null };
    }

    const matchedProviders = Array.from(this.providerMap.values())
      .filter(p => p.model === modelName);

    if (matchedProviders.length > 0) {
      return { memberGroups: [{ refId: modelName, targets: matchedProviders }], combo: null };
    }

    const matchedGroup = Array.from(this.groupMap.values()).find(g => g.model === modelName);
    if (matchedGroup) {
      const targets = matchedGroup.providers.filter(p => p.enabled !== false);
      return { memberGroups: [{ refId: matchedGroup.id, targets }], combo: null };
    }

    // Phase C: 能力图谱自动桥接
    if (this._bridgeEnabled) {
      const availableModels = [
        ...new Set(
          (this.config.providers || [])
            .filter(p => p.enabled !== false)
            .map(p => p.model)
        )
      ];

      const bridgeCandidates = getBridgeCandidates(modelName, availableModels);

      if (bridgeCandidates.length > 0) {
        for (const candidate of bridgeCandidates) {
          try {
            const bridged = this.resolve(candidate);
            bridged._bridged_from = modelName;
            bridged._bridged_to = candidate;
            if (this._bridgeLog.length > 200) this._bridgeLog.shift();
            this._bridgeLog.push({ from: modelName, to: candidate, ts: Date.now() });
            return bridged;
          } catch {
          }
        }
      }
    }

    throw new Error(`Model not found and no bridge available: ${modelName}`);
  }

  getCombo(modelName) {
    const aliasTarget = this.config.aliases?.[modelName];
    const resolvedName = aliasTarget || modelName;
    return this.comboMap.get(resolvedName) || null;
  }

  _selectMembersOrdered(combo) {
    const strategy = combo.strategy || 'fallback';
    const members = combo.members || [];

    if (strategy === 'round-robin') {
      const startIdx = this._getRRIndex(combo.id, members.length);
      const ordered = [];
      for (let offset = 0; offset < members.length; offset++) {
        const idx = (startIdx + offset) % members.length;
        ordered.push(members[idx]);
      }
      return ordered;
    }
    
    if (strategy === 'weighted') {
      const weightedList = [];
      for (const member of members) {
        const weight = member.weight || 1;
        for (let i = 0; i < weight; i++) weightedList.push(member);
      }
      for (let i = weightedList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [weightedList[i], weightedList[j]] = [weightedList[j], weightedList[i]];
      }
      const added = new Set();
      const ordered = [];
      for (const member of weightedList) {
        if (added.has(member.group)) continue;
        added.add(member.group);
        ordered.push(member);
      }
      return ordered;
    }
    
    return [...members];
  }

  _getRRIndex(comboId, memberCount) {
    if (!this._rrCounters.has(comboId)) {
      this._rrCounters.set(comboId, 0);
    }
    const cur = this._rrCounters.get(comboId);
    this._rrCounters.set(comboId, (cur + 1) % memberCount);
    return cur;
  }

  _getMemberTargets(refId) {
    if (this.groupMap.has(refId)) {
      const group = this.groupMap.get(refId);
      return group.providers.filter(p => p.enabled !== false);
    }
    if (this.providerMap.has(refId)) {
      return [this.providerMap.get(refId)];
    }
    const byModel = Array.from(this.providerMap.values()).filter(p => p.model === refId);
    if (byModel.length > 0) return byModel;
    const groupByModel = Array.from(this.groupMap.values()).find(g => g.model === refId);
    if (groupByModel) return groupByModel.providers.filter(p => p.enabled !== false);
    return [];
  }
  
  getAllProviders() {
    return Array.from(this.providerMap.values());
  }

  getAllGroups() {
    return Array.from(this.groupMap.values());
  }
}
