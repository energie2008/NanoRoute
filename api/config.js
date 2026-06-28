import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateConfig, configToYaml, reloadConfig, expandGroups } from '../config.js';
import { setGlobalProxy as initProxyPool } from '../proxy/pool.js';
import { Router } from '../router/index.js';

const CONFIG_PATH = resolve('./config.yml');
const BACKUP_PATH = resolve('./config.yml.bak');

export class ConfigAPI {
  constructor(getConfig, reloadFn) {
    this._getConfig = getConfig;
    this._reload = async (newCfgOrNull) => {
      let cfgToLoad;
      if (newCfgOrNull === null) {
        cfgToLoad = reloadConfig(CONFIG_PATH);
      } else {
        cfgToLoad = expandGroups(newCfgOrNull);
      }
      const hasArray = Array.isArray(cfgToLoad.proxies);
      const proxyConfig = hasArray && cfgToLoad.proxies.length > 0
        ? cfgToLoad.proxies
        : cfgToLoad.proxy;
      initProxyPool(proxyConfig);
      if (reloadFn) {
        reloadFn(cfgToLoad);
      }
    };
  }

  async handle(req, res, path, body, { sendJSON, sendError }) {
    if (req.method === 'GET' && path === '/api/config') {
      const cfg = this._getConfig();
      const safe = JSON.parse(JSON.stringify(cfg));
      const providers = safe.providers || [];
      providers.forEach(p => {
        if (p.vendor_type) {
          p.type = p.vendor_type;
        }
      });
      sendJSON(res, { ok: true, config: safe });
      return true;
    }

    if (req.method === 'GET' && path === '/api/config/full') {
      const cfg = JSON.parse(JSON.stringify(this._getConfig()));
      (cfg.providers || []).forEach(p => {
        if (p.vendor_type) p.type = p.vendor_type;
      });
      sendJSON(res, { ok: true, config: cfg });
      return true;
    }

    if (req.method === 'POST' && path === '/api/config/validate') {
      const cfg = body ? (body.config || body) : {};
      const errors = validateConfig(cfg);
      const status = errors.length ? 422 : 200;
      const result = errors.length
        ? { ok: false, errors }
        : { ok: true, message: '校验通过' };
      sendJSON(res, result, status);
      return true;
    }

    if (req.method === 'POST' && path === '/api/config') {
      const newCfg = body ? (body.config || body) : {};
      const errors = validateConfig(newCfg);
      if (errors.length) {
        sendJSON(res, { ok: false, errors }, 422);
        return true;
      }
      try {
        if (existsSync(CONFIG_PATH)) copyFileSync(CONFIG_PATH, BACKUP_PATH);
        writeFileSync(CONFIG_PATH, configToYaml(newCfg), 'utf-8');
        await this._reload(newCfg);
        sendJSON(res, {
          ok: true,
          message: '配置已保存并热重载',
          providers: newCfg.providers ? newCfg.providers.length : 0,
          backup: 'config.yml.bak',
        });
      } catch (err) {
        if (existsSync(BACKUP_PATH)) copyFileSync(BACKUP_PATH, CONFIG_PATH);
        sendJSON(res, { ok: false, error: `写入失败: ${err.message}`, rolled_back: true }, 500);
      }
      return true;
    }

    if (req.method === 'POST' && path === '/api/config/reload') {
      try {
        await this._reload(null);
        const cfg = this._getConfig();
        sendJSON(res, { ok: true, message: '已从磁盘重新加载', providers: cfg.providers ? cfg.providers.length : 0 });
      } catch (err) {
        sendJSON(res, { ok: false, error: err.message }, 500);
      }
      return true;
    }

    if (req.method === 'POST' && path === '/api/config/rollback') {
      if (!existsSync(BACKUP_PATH)) {
        sendJSON(res, { ok: false, error: '没有可用的备份 (config.yml.bak 不存在)' }, 404);
        return true;
      }
      try {
        copyFileSync(BACKUP_PATH, CONFIG_PATH);
        await this._reload(null);
        sendJSON(res, { ok: true, message: '已回滚到上一版本' });
      } catch (err) {
        sendJSON(res, { ok: false, error: err.message }, 500);
      }
      return true;
    }

    return false;
  }
}
