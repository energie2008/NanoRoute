import { MIN_COMPRESS_SIZE } from './constants.js';

export function applyFilterSafe(text, filterFn, filterName) {
  try {
    if (typeof text !== 'string') return { compressed: false, text, saved: 0 };
    if (text.length < MIN_COMPRESS_SIZE) return { compressed: false, text, saved: 0 };

    const originalLength = text.length;
    const compressed = filterFn(text);

    if (typeof compressed !== 'string' || compressed.length >= originalLength || compressed.length === 0) {
      return { compressed: false, text, saved: 0 };
    }

    return {
      compressed: true,
      text: compressed,
      saved: originalLength - compressed.length,
      filter: filterName
    };
  } catch {
    return { compressed: false, text, saved: 0 };
  }
}
