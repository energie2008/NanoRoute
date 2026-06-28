import { CONTEXT_HEAD, CONTEXT_TAIL } from '../constants.js';

export function compressReadFile(text) {
  if (text.length <= CONTEXT_HEAD + CONTEXT_TAIL + 100) {
    return text;
  }

  const head = text.slice(0, CONTEXT_HEAD);
  const tail = text.slice(-CONTEXT_TAIL);
  const omitted = text.length - CONTEXT_HEAD - CONTEXT_TAIL;

  return `${head}\n\n... [${omitted} bytes truncated in middle] ...\n\n${tail}`;
}
