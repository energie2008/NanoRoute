export function autoDetectFilter(text) {
  if (typeof text !== 'string' || text.length < 100) return null;

  if (text.startsWith('diff --git') || /^@@ -\d+,\d+ \+\d+,\d+ @@/m.test(text)) {
    return 'git';
  }

  if (/(drwx|[-rwx]{9})\s+\d+\s+\w+\s+\w+/.test(text) && text.split('\n').length > 5) {
    return 'shell';
  }
  if (text.includes('$ ') && text.includes('\n') && (/total \d+/.test(text) || /^[\w-]+\s+[\w-]+\s+\d+/.test(text))) {
    return 'shell';
  }

  if (text.includes('npm error') || text.includes('error TS') || text.includes('Compiling') ||
      text.includes('Build succeeded') || text.includes('Build failed') || text.includes('webpack') ||
      text.includes('vite') || text.includes('ERROR in')) {
    return 'build';
  }

  const lineCount = text.split('\n').length;
  if (lineCount > 20) {
    const firstLines = text.split('\n').slice(0, 20);
    const hasTimestampPattern = firstLines.some(l => /^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}/.test(l));
    if (hasTimestampPattern) {
      return 'logs';
    }
  }

  const lineNumberMatch = text.match(/^\s*\d+\s*\|/m);
  if (lineNumberMatch) {
    const lineNumLines = text.split('\n').filter(l => /^\s*\d+\s*\|/.test(l)).length;
    if (lineNumLines > 3) {
      return 'readfile';
    }
  }

  return null;
}
