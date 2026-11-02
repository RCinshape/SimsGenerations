const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

function hash(text) {
  return createHash('sha256').update(text).digest('hex');
}

function findObject(source, name) {
  const match = new RegExp('\\bvar\\s+' + name + '\\s*=\\s*\\{').exec(source);
  if (!match) throw new Error('missing ' + name + ' object');
  const open = source.indexOf('{', match.index), start = open;
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i], next = source[i + 1];
    if (lineComment) { if (c === '\n') lineComment = false; continue; }
    if (blockComment) { if (c === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { lineComment = true; i++; continue; }
    if (c === '/' && next === '*') { blockComment = true; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { start, end: i + 1 };
  }
  throw new Error('unterminated ' + name + ' object');
}

function findStringProperty(source, objectRange, property) {
  const object = source.slice(objectRange.start, objectRange.end);
  const match = new RegExp('(?:[\'\"]' + property + '[\'\"]|\\b' + property + '\\b)\\s*:\\s*').exec(object);
  if (!match) throw new Error('missing ' + property + ' property');
  const start = objectRange.start + match.index + match[0].length;
  const quote = source[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') throw new Error(property + ' is not a string literal');
  let escaped = false;
  for (let i = start + 1; i < objectRange.end; i++) {
    const c = source[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (quote === '`' && c === '$' && source[i + 1] === '{') throw new Error('template interpolation is not supported');
    if (c === quote) {
      const end = i + 1;
      const literal = source.slice(start, end);
      let value;
      try { value = vm.runInNewContext('(' + literal + ')', Object.create(null), { timeout: 100 }); }
      catch (e) { throw new Error('could not decode ' + property + ' string'); }
      if (typeof value !== 'string') throw new Error(property + ' is not a string');
      return { start, end, value };
    }
  }
  throw new Error('unterminated ' + property + ' string');
}

function replaceOnce(text, pattern, replacement, label) {
  const matches = pattern.global ? [...text.matchAll(pattern)] : (pattern.test(text) ? [true] : []);
  if (matches.length !== 1) throw new Error(label + ' marker count was ' + matches.length);
  return text.replace(pattern, replacement);
}

function replaceStatusBlock(text, startMarker, endMarker, replacement, from, label) {
  const start = text.indexOf(startMarker, from);
  if (start < 0) throw new Error(label + ' start marker missing');
  if (text.indexOf(startMarker, start + startMarker.length) >= 0) throw new Error(label + ' start marker repeated');
  const markerEnd = text.indexOf(endMarker, start + startMarker.length);
  if (markerEnd < 0) throw new Error(label + ' end marker missing');
  const close = text.indexOf('\n}', markerEnd + endMarker.length);
  if (close < 0) throw new Error(label + ' closing brace missing');
  return text.slice(0, start) + replacement + text.slice(close + 2);
}

function captureLinesBlock(logName) {
  return [
    `$beforeLines = @()`,
    `$beforeReadable = $true`,
    `try { if (Test-Path -LiteralPath $${logName}) { $beforeLines = @(Get-Content -LiteralPath $${logName} -ErrorAction Stop) } }`,
    `catch { $beforeReadable = $false; $beforeLines = @() }`
  ].join('\n');
}

function freshLinesBlock(logName) {
  return [
    `$allLines = @()`,
    `$afterReadable = $true`,
    `try { if (Test-Path -LiteralPath $${logName}) { $allLines = @(Get-Content -LiteralPath $${logName} -ErrorAction Stop) } }`,
    `catch { $afterReadable = $false; $allLines = @() }`,
    `$freshLines = @()`,
    `if ($beforeReadable -and $afterReadable) {`,
    `    $prefixUnchanged = $allLines.Count -ge $beforeLines.Count`,
    `    if ($prefixUnchanged) {`,
    `        for ($lineIndex = 0; $lineIndex -lt $beforeLines.Count; $lineIndex++) {`,
    `            if ($allLines[$lineIndex] -cne $beforeLines[$lineIndex]) { $prefixUnchanged = $false; break }`,
    `        }`,
    `    }`,
    `    if ($prefixUnchanged) { $freshLines = @($allLines | Select-Object -Skip $beforeLines.Count) }`,
    `    else { $freshLines = @($allLines) }`,
    `}`
  ].join('\n');
}

function patchInstaller(template) {
  const invocation = `try { if ($Dry) { & pwsh -NoProfile -File $ps1 } else { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps1 } } catch {}`;
  const prelude = `$slog = Join-Path $home2 'sync.log'\n` + captureLinesBlock('slog') + '\n';
  let out = replaceOnce(template, new RegExp(invocation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), prelude + invocation, 'installer invocation');
  const status = [
    freshLinesBlock('slog'),
    `$sentLine = @($freshLines | Where-Object { $_ -match ' sent ' } | Select-Object -Last 1)`,
    `$updateLine = @($freshLines | Where-Object { $_ -match 'updated to v\\d+ \\(signature checked\\)' } | Select-Object -Last 1)`,
    `$last = if ($freshLines.Count) { $freshLines[-1] } else { 'no new status from helper' }`,
    `if ($sentLine.Count -gt 0 -or $updateLine.Count -gt 0) {`,
    `    Ok "connected"`,
    `    if ($updateLine.Count -gt 0) { Say ($updateLine[-1] -replace '^\\S+\\s', '') Green }`,
    `} else {`,
    `    Write-Host " not yet" -ForegroundColor Yellow`,
    `    Say ("The first contact didn't work: " + ($last -replace '^\\S+\\s', '')) Yellow`,
    `    Say "It tries again by itself every 5 minutes. If the app stays grey, send the host a photo of this." Yellow`,
    `}`
  ].join('\n');
  const invocationEnd = out.indexOf(invocation) + invocation.length;
  return replaceStatusBlock(out, "$slog = Join-Path $home2 'sync.log'", 'Say "It tries again by itself every 5 minutes. If the app stays grey, send the host a photo of this." Yellow', status, invocationEnd, 'installer status block');
}

function patchHelper(template) {
  const invocation = `if ($Dry) { & pwsh -NoProfile -File $ps1 } else { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps1 }`;
  const prelude = `$log = Join-Path $Home2 'sync.log'\n` + captureLinesBlock('log') + '\n';
  let out = replaceOnce(template, new RegExp(invocation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), prelude + invocation, 'helper invocation');
  const status = [
    freshLinesBlock('log'),
    `$sentLine = @($freshLines | Where-Object { $_ -match ' sent ' } | Select-Object -Last 1)`,
    `$updateLine = @($freshLines | Where-Object { $_ -match 'updated to v\\d+ \\(signature checked\\)' } | Select-Object -Last 1)`,
    `$last = if ($freshLines.Count) { $freshLines[-1] } else { 'no new status from helper' }`,
    `Write-Host ""`,
    `if ($sentLine.Count -gt 0 -or $updateLine.Count -gt 0) {`,
    `    Say "ALL DONE, $Name!" Cyan`,
    `    Say "Start The Sims 4 and play your legacy. The app updates by itself." White`,
    `    if ($updateLine.Count -gt 0) { Say ($updateLine[-1] -replace '^\\S+\\s', '') Green }`,
    `} else {`,
    `    Say ("Installed, but the first contact didn't work yet (" + ($last -replace '^\\S+\\s', '') + ").") Yellow`,
    `    Say "That's OK: it tries again by itself every 30 minutes." White`,
    `}`
  ].join('\n');
  const invocationEnd = out.indexOf(invocation) + invocation.length;
  return replaceStatusBlock(out, "$log = Join-Path $Home2 'sync.log'", 'Say "That\'s OK: it tries again by itself every 30 minutes." White', status, invocationEnd, 'helper status block');
}

function patchTemplate(source, objectName, patcher) {
  const range = findObject(source, objectName);
  const prop = findStringProperty(source, range, 'template');
  const updated = patcher(prop.value);
  return source.slice(0, prop.start) + JSON.stringify(updated) + source.slice(prop.end);
}

function build(source) {
  let output = patchTemplate(source, 'INSTALLER', patchInstaller);
  output = patchTemplate(output, 'HELPER', patchHelper);
  new vm.Script(output, { filename: 'patched-private-backend.gs' });
  return output;
}

module.exports = { build, patchHelper, patchInstaller };

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output || path.resolve(input) === path.resolve(output)) {
    throw new Error('usage: node scripts/patch-installer-status.cjs PRIVATE_INPUT.gs PRIVATE_OUTPUT.gs');
  }
  const original = fs.readFileSync(input, 'utf8');
  const result = build(original);
  fs.writeFileSync(output, result, { mode: 0o600 });
  console.log(JSON.stringify({ inputSha256: hash(original), outputSha256: hash(result), changed: true }));
}
