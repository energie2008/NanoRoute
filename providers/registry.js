/**
 * Provider Registry
 * Lazy-load providers on demand to save memory
 */

const REGISTRY = {
  'gemini': { loader: () => import('./gemini.js'), export: 'GeminiProvider' },
  'openai': { loader: () => import('./openai.js'), export: 'OpenAIProvider' },
  'anthropic': { loader: () => import('./anthropic.js'), export: 'AnthropicProvider' },
};

const classCache = new Map();

/**
 * Load provider class
 * @param {string} type - Provider type (e.g., 'gemini', 'openai')
 * @returns {Promise<typeof BaseProvider>} Provider class
 */
export async function loadProvider(type) {
  if (classCache.has(type)) {
    return classCache.get(type);
  }

  const entry = REGISTRY[type];
  if (!entry) {
    throw new Error(`Unknown provider type: ${type}`);
  }

  try {
    const module = await entry.loader();
    const ProviderClass = module[entry.export];
    if (!ProviderClass) {
      throw new Error(`Export ${entry.export} not found in module ${type}`);
    }
    classCache.set(type, ProviderClass);
    return ProviderClass;
  } catch (err) {
    throw new Error(`Failed to load provider ${type}: ${err.message}`);
  }
}

/**
 * Clear provider cache (for testing or hot reload)
 */
export function clearCache() {
  classCache.clear();
}

/**
 * Get cached providers (for stats)
 */
export function getCachedProviders() {
  return Array.from(classCache.keys());
}
