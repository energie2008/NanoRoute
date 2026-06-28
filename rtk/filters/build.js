export function compressBuildOutput(text) {
  const lines = text.split('\n');
  const result = [];
  const errors = [];
  const warnings = [];
  let success = false;
  let failed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/error|ERROR|failed|FAILED/i.test(line) && !/warning/i.test(line)) {
      errors.push(line.trim());
    } else if (/warning|WARN/i.test(line)) {
      warnings.push(line.trim());
    } else if (/success|SUCCESS|compiled|build succeeded|done/i.test(line)) {
      success = true;
    } else if (/build failed|compile failed|error/i.test(line)) {
      failed = true;
    }

    if (i < 10 || i >= lines.length - 5) {
      result.push(line);
    }
  }

  if (errors.length > 0 || warnings.length > 0) {
    const summary = [];
    if (errors.length > 0) summary.push(`Errors (${errors.length}):`);
    errors.slice(0, 10).forEach(e => summary.push(`  ${e}`));
    if (errors.length > 10) summary.push(`  ... ${errors.length - 10} more errors`);
    if (warnings.length > 0) summary.push(`Warnings (${warnings.length}):`);
    warnings.slice(0, 5).forEach(w => summary.push(`  ${w}`));
    if (warnings.length > 5) summary.push(`  ... ${warnings.length - 5} more warnings`);
    if (success) summary.push('Build: SUCCESS');
    if (failed) summary.push('Build: FAILED');
    result.push('');
    result.push('=== Build Summary ===');
    result.push(summary.join('\n'));
  }

  return result.join('\n');
}
