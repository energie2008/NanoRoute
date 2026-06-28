export function compressShellOutput(text) {
  const lines = text.split('\n');
  const result = [];
  let fileLines = 0;
  let fileDirs = 0;
  let skipped = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('$ ') || line.startsWith('#') || line.includes('total ') || i < 3) {
      result.push(line);
      continue;
    }

    if (/^[drwx-]{10}/.test(line) || /^[\w.-]+\s+\d+\s+\w+\s+\w+/.test(line)) {
      if (line.startsWith('d')) fileDirs++;
      else fileLines++;
      if (fileLines + fileDirs <= 20) {
        result.push(line);
      } else {
        skipped++;
      }
      continue;
    }

    if (skipped > 0) {
      result.push(`... ${skipped} files/directories omitted ...`);
      result.push(`Directories: ${fileDirs}, Files: ${fileLines}`);
      skipped = 0;
    }
    result.push(line);
  }

  if (skipped > 0) {
    result.push(`... ${skipped} entries omitted ...`);
    result.push(`Total: ${fileDirs} directories, ${fileLines} files`);
  }

  return result.join('\n');
}
