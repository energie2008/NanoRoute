import { MIN_COMPRESS_SIZE, RAW_CAP, CONTEXT_HEAD, CONTEXT_TAIL } from './constants.js';
import { autoDetectFilter } from './autodetect.js';
import { applyFilterSafe } from './applyFilter.js';
import { compressGitDiff } from './filters/git.js';
import { compressShellOutput } from './filters/shell.js';
import { compressBuildOutput } from './filters/build.js';
import { compressLogs } from './filters/logs.js';
import { compressReadFile } from './filters/readfile.js';

const filters = {
  git: compressGitDiff,
  shell: compressShellOutput,
  build: compressBuildOutput,
  logs: compressLogs,
  readfile: compressReadFile,
};

function getTextContent(content) {
  if (typeof content === 'string') return content;
  if (content?.text) return content.text;
  if (content?.content) {
    if (Array.isArray(content.content)) return content.content.map(c => getTextContent(c)).join('\n');
    if (typeof content.content === 'string') return content.content;
  }
  return '';
}

function setTextContent(content, newText) {
  if (typeof content === 'string') return newText;
  if (content?.text !== undefined) { content.text = newText; return content; }
  if (content?.content !== undefined) {
    if (typeof content.content === 'string') { content.content = newText; return content; }
  }
  return content;
}

function compressText(text, config = {}) {
  if (typeof text !== 'string' || text.length < MIN_COMPRESS_SIZE) {
    return { compressed: false, text, saved: 0, hits: [] };
  }

  if (text.length > RAW_CAP) {
    text = text.slice(0, CONTEXT_HEAD) + `\n\n... [${text.length - CONTEXT_HEAD - CONTEXT_TAIL} bytes truncated due to size limit] ...\n\n` + text.slice(-CONTEXT_TAIL);
    return { compressed: true, text, saved: text.length - (CONTEXT_HEAD + CONTEXT_TAIL + 200), hits: [{ filter: 'truncation', saved: text.length - (CONTEXT_HEAD + CONTEXT_TAIL) }] };
  }

  const filterName = autoDetectFilter(text);
  if (!filterName) {
    return { compressed: false, text, saved: 0, hits: [] };
  }

  const filterFn = filters[filterName];
  if (!filterFn) {
    return { compressed: false, text, saved: 0, hits: [] };
  }

  const result = applyFilterSafe(text, filterFn, filterName);
  if (result.compressed) {
    return { compressed: true, text: result.text, saved: result.saved, hits: [{ filter: filterName, saved: result.saved }] };
  }

  return { compressed: false, text, saved: 0, hits: [] };
}

export function compressMessages(body, config = {}) {
  const stats = {
    bytesBefore: 0,
    bytesAfter: 0,
    hits: [],
    compressedCount: 0
  };

  try {
    const enabled = config.enabled ?? true;
    if (!enabled) return { body, stats: null };

    if (!body || !body.messages) return { body, stats: null };

    let totalBefore = 0;
    let totalAfter = 0;

    for (let i = 0; i < body.messages.length; i++) {
      const msg = body.messages[i];
      const isToolRole = msg.role === 'tool' || msg.role === 'tool_result';
      const isToolType = msg.type === 'tool_result';
      const isError = msg.is_error === true;

      if (isError) continue;
      if (!isToolRole && !isToolType) continue;

      const originalText = getTextContent(msg.content ?? msg);
      if (!originalText || typeof originalText !== 'string') continue;

      totalBefore += originalText.length;

      const result = compressText(originalText, config);
      if (result.compressed) {
        if (typeof msg.content === 'string') {
          msg.content = result.text;
        } else if (msg.content?.text !== undefined) {
          msg.content.text = result.text;
        } else {
          msg.content = result.text;
        }
        totalAfter += result.text.length;
        stats.hits.push(...result.hits);
        stats.compressedCount++;
      } else {
        totalAfter += originalText.length;
      }
    }

    stats.bytesBefore = totalBefore;
    stats.bytesAfter = totalAfter;
    stats.savedBytes = totalBefore - totalAfter;

    return { body, stats };
  } catch {
    return { body, stats: null };
  }
}

export function injectCavemanPrompt(body, enabled = true) {
  if (!enabled || !body?.messages) return body;

  const cavemanPrompt = 'Be concise. Minimal explanation. Code only unless asked. No apologies. No unnecessary text.';

  const systemMsgIndex = body.messages.findIndex(m => m.role === 'system');
  if (systemMsgIndex >= 0) {
    const existing = body.messages[systemMsgIndex];
    let existingContent = '';
    if (typeof existing.content === 'string') {
      existingContent = existing.content;
    } else if (existing.content?.text) {
      existingContent = existing.content.text;
    }
    if (!existingContent.includes(cavemanPrompt)) {
      const newContent = `${cavemanPrompt}\n\n${existingContent}`;
      if (typeof existing.content === 'string') {
        existing.content = newContent;
      } else if (existing.content?.text !== undefined) {
        existing.content.text = newContent;
      }
    }
  } else {
    body.messages.unshift({ role: 'system', content: cavemanPrompt });
  }

  return body;
}
