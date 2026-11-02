const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { build } = require('../scripts/patch-installer-status.cjs');

const installerTemplate = [
  'try { if ($Dry) { & pwsh -NoProfile -File $ps1 } else { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps1 } } catch {}',
  "$slog = Join-Path $home2 'sync.log'",
  "$last = if (Test-Path -LiteralPath $slog) { Get-Content -LiteralPath $slog -Tail 1 } else { '' }",
  `if ($last -match ' sent ') { Ok "connected" }`,
  'else {',
  '    Write-Host " not yet" -ForegroundColor Yellow',
  `    Say ("The first contact didn't work: " + ($last -replace '^\\S+\\s', '')) Yellow`,
  `    Say "It tries again by itself every 5 minutes. If the app stays grey, send the host a photo of this." Yellow`,
  '}',
].join('\n');

const helperTemplate = [
  'if ($Dry) { & pwsh -NoProfile -File $ps1 } else { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $ps1 }',
  "$log = Join-Path $Home2 'sync.log'",
  "$last = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 1 } else { '' }",
  'Write-Host ""',
  `if ($last -match ' sent ') {`,
  `    Say "ALL DONE, $Name!" Cyan`,
  `    Say "Start The Sims 4 and play your legacy. The app updates by itself." White`,
  `} else {`,
  `    Say "Installed, but the first contact didn't work yet ($last)." Yellow`,
  `    Say "That's OK: it tries again by itself every 30 minutes." White`,
  '}',
  'Write-Host ""',
].join('\n');

function fixture() {
  return `var HELPER = {head:"h",template:${JSON.stringify(helperTemplate)},uploader:"uploader stays byte-for-byte",mod:"mod stays byte-for-byte"};\n` +
    `var INSTALLER = {head:"i",template:${JSON.stringify(installerTemplate)}};\n`;
}

function extractBlocks(template) {
  const captureStart = template.indexOf('$beforeLines = @()');
  let runAt = template.indexOf('try { if ($Dry)', captureStart);
  if (runAt < 0) runAt = template.indexOf('if ($Dry) { & pwsh', captureStart);
  const freshStart = template.indexOf('$allLines = @()', runAt);
  const sentAt = template.indexOf('$sentLine = @(', freshStart);
  const branchAt = template.indexOf('if ($sentLine.Count -gt 0 -or $updateLine.Count -gt 0) {', sentAt);
  assert.ok(captureStart >= 0 && runAt > captureStart && freshStart > runAt && sentAt > freshStart && branchAt > sentAt);
  return {
    capture: template.slice(captureStart, runAt).trim(),
    fresh: template.slice(freshStart, sentAt).trim(),
    classify: template.slice(sentAt, branchAt).trim(),
  };
}

function escapePs(value) { return "'" + value.replace(/'/g, "''") + "'"; }
function powershellAvailable() {
  const probe = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

const hasPwsh = powershellAvailable();

test('both templates snapshot the pre-run log and use a case-sensitive prefix check', () => {
  const patched = build(fixture());
  const decoded = vm.runInNewContext(patched + '\n;({helper:HELPER,installer:INSTALLER})');
  for (const template of [decoded.helper.template, decoded.installer.template]) {
    const { capture, fresh } = extractBlocks(template);
    assert.match(capture, /\$beforeLines = @\(\)/);
    assert.match(capture, /Get-Content -LiteralPath \$\w+/);
    assert.match(capture, /\$beforeReadable = \$true/);
    assert.match(capture, /catch \{ \$beforeReadable = \$false/);
    assert.match(capture, /-ErrorAction Stop/);
    assert.match(fresh, /\$allLines = @\(\)/);
    assert.match(fresh, /\$afterReadable = \$true/);
    assert.match(fresh, /catch \{ \$afterReadable = \$false/);
    assert.match(fresh, /if \(\$beforeReadable -and \$afterReadable\)/);
    assert.match(fresh, /-cne \$beforeLines\[\$lineIndex\]/);
    assert.match(fresh, /\$prefixUnchanged/);
    assert.match(fresh, /Select-Object -Skip \$beforeLines\.Count/);
    assert.doesNotMatch(template, /-Tail 1/);
    assert.match(template, /no new status from helper/);
    assert.match(template, /if \(\$sentLine\.Count -gt 0 -or \$updateLine\.Count -gt 0\) \{/);
    assert.ok(template.indexOf('$beforeLines = @()') < template.indexOf('if ($Dry) { & pwsh'));
  }
  assert.equal(decoded.helper.uploader, 'uploader stays byte-for-byte');
  assert.equal(decoded.helper.mod, 'mod stays byte-for-byte');
});

test('patcher rejects a second application instead of changing an already-patched source', () => {
  assert.throws(() => build(build(fixture())), /marker missing|marker repeated/);
});

test('generated PowerShell handles appended lines and log rotation in both templates', { skip: !hasPwsh && 'pwsh is unavailable' }, () => {
  const decoded = vm.runInNewContext(build(fixture()) + '\n;({helper:HELPER,installer:INSTALLER})');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-installer-log-'));
  try {
    const cases = [
      { name: 'sent_then_update', before: ['old line'], after: ['old line', '2026-11-02T15:14:38 sent (ok)', '2026-11-02T15:14:41 updated to v7 (signature checked)'], fresh: ['2026-11-02T15:14:38 sent (ok)', '2026-11-02T15:14:41 updated to v7 (signature checked)'], connected: true, update: true },
      { name: 'old_sent_new_error', before: ['2026-11-02T15:00:00 sent (old success)'], after: ['2026-11-02T15:00:00 sent (old success)', '2026-11-02T15:20:00 error: offline'], fresh: ['2026-11-02T15:20:00 error: offline'], connected: false, update: false },
      { name: 'unchanged_old_sent', before: ['2026-11-02T15:00:00 sent (old success)'], after: ['2026-11-02T15:00:00 sent (old success)'], fresh: [], connected: false, update: false },
      { name: 'unchanged_old_update', before: ['2026-11-02T15:14:41 updated to v7 (signature checked)'], after: ['2026-11-02T15:14:41 updated to v7 (signature checked)'], fresh: [], connected: false, update: false },
      { name: 'rotated_over_200kb_count_drop', before: Array.from({length:240},(_,i)=>String(i).padEnd(1024,'x')), after: ['2026-11-02T15:14:38 sent (rotated upload)', '2026-11-02T15:14:41 updated to v7 (signature checked)'], fresh: ['2026-11-02T15:14:38 sent (rotated upload)', '2026-11-02T15:14:41 updated to v7 (signature checked)'], connected: true, update: true },
      { name: 'rotation_between_sent_and_update', before: Array.from({length:198},(_,i)=>String(i).padEnd(1024,'x')), after: ['2026-11-02T15:14:41 updated to v7 (signature checked)'], fresh: ['2026-11-02T15:14:41 updated to v7 (signature checked)'], connected: true, update: true },
      { name: 'one_huge_line_replaced_count_increases', before: ['x'.repeat(225000)], after: ['2026-11-02T15:14:38 sent (new file)', '2026-11-02T15:14:41 updated to v7 (signature checked)'], fresh: ['2026-11-02T15:14:38 sent (new file)', '2026-11-02T15:14:41 updated to v7 (signature checked)'], connected: true, update: true },
      { name: 'case_only_prefix_change', before: ['2026-11-02T15:00:00 sent (old success)'], after: ['2026-11-02T15:00:00 SENT (new prefix)'], fresh: ['2026-11-02T15:00:00 SENT (new prefix)'], connected: true, update: false },
      { name: 'fresh_refusal', before: [], after: ['2026-11-02T15:20:00 refused: invalid response'], fresh: ['2026-11-02T15:20:00 refused: invalid response'], connected: false, update: false },
      { name: 'missing_log', before: null, after: null, fresh: [], connected: false, update: false, latest: 'no new status from helper' },
      { name: 'pre_read_failure', before: ['2026-11-02T15:00:00 sent (old success)'], after: ['2026-11-02T15:00:00 sent (old success)'], fresh: [], connected: false, update: false, latest: 'no new status from helper', failRead: 1 },
      { name: 'post_read_failure', before: ['2026-11-02T15:00:00 sent (old success)'], after: ['2026-11-02T15:14:38 sent (new success)'], fresh: [], connected: false, update: false, latest: 'no new status from helper', failRead: 2 },
    ];
    for (const channel of ['helper', 'installer']) {
      const { capture, fresh, classify } = extractBlocks(decoded[channel].template);
      for (const item of cases) {
        const logPath = path.join(temp, channel + '-' + item.name + '.log');
        if (item.before) fs.writeFileSync(logPath, item.before.join('\r\n') + '\r\n');
        const script = [
          '$ErrorActionPreference = "Stop"',
          `$log = ${escapePs(logPath)}`,
          `$slog = ${escapePs(logPath)}`,
          ...(item.failRead ? [
            '$script:readCount = 0',
            'function Get-Content { [CmdletBinding()] param([string]$LiteralPath) $script:readCount++; if ($script:readCount -eq ' + item.failRead + ') { throw "simulated log read race" }; [IO.File]::ReadAllLines($LiteralPath) }',
          ] : []),
          capture,
          item.after ? `[IO.File]::WriteAllLines($log, [string[]]@(${item.after.map(escapePs).join(',')}))` : 'Remove-Item -LiteralPath $log -Force -ErrorAction SilentlyContinue',
          fresh,
          classify,
          `[Console]::Write((ConvertTo-Json -InputObject @{fresh=@($freshLines);connected=($sentLine.Count -gt 0 -or $updateLine.Count -gt 0);update=($updateLine.Count -gt 0);latest=$last} -Compress))`,
        ].join('\n');
        const scriptPath = path.join(temp, channel + '-' + item.name + '.ps1');
        fs.writeFileSync(scriptPath, script);
        const run = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', scriptPath], { encoding: 'utf8' });
        assert.equal(run.status, 0, channel + ' ' + item.name + ' generated PowerShell block failed');
        const actual = JSON.parse(run.stdout || '{}');
        assert.deepEqual(actual.fresh, item.fresh, channel + ' ' + item.name);
        assert.equal(actual.connected, item.connected, channel + ' ' + item.name + ' connected state');
        assert.equal(actual.update, item.update, channel + ' ' + item.name + ' update state');
        assert.equal(actual.latest, item.latest || item.fresh.at(-1) || 'no new status from helper', channel + ' ' + item.name + ' latest status');
      }
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
