export function compressGitDiff(text) {
  const lines = text.split('\n');
  const result = [];
  let contextCount = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('diff --git') || line.startsWith('index ') ||
        line.startsWith('--- ') || line.startsWith('+++ ') ||
        line.startsWith('@@ ') || line.startsWith('+') || line.startsWith('-') ||
        line.startsWith('new file') || line.startsWith('deleted file') ||
        line.startsWith('rename ')) {
      if (skipped > 0) {
        result.push(`... ${skipped} context lines omitted ...`);
        skipped = 0;
      }
      result.push(line);
      contextCount = 0;
    } else {
      contextCount++;
      if (contextCount <= 3) {
        result.push(line);
      } else {
        skipped++;
      }
    }
  }

  if (skipped > 0) {
    result.push(`... ${skipped} context lines omitted ...`);
  }

  return result.join('\n');
}
