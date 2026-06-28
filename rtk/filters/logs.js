export function compressLogs(text) {
  const lines = text.split('\n');
  const result = [];
  const uniqueLines = new Map();
  let duplicates = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.replace(/^\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}[.,]\d+\s*/, '').replace(/^\[\w+\]\s*/, '');

    if (uniqueLines.has(stripped)) {
      uniqueLines.set(stripped, uniqueLines.get(stripped) + 1);
      duplicates++;
    } else {
      uniqueLines.set(stripped, 1);
      result.push(line);
    }
  }

  if (duplicates > 0) {
    result.push('');
    result.push(`... ${duplicates} duplicate log lines removed ...`);
    result.push(`Unique log lines: ${uniqueLines.size}`);
  }

  return result.join('\n');
}
