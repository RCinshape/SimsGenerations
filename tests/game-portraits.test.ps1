# Run with Windows PowerShell 5.1 or PowerShell 7: pwsh -File tests/game-portraits.test.ps1 [path\to\localthumbcache.package]
# The refpack/DBPF/upload logic is checked with synthetic data; the real-file checks run only when a sample package is given
# (argument or $env:GAME_PKG; it is private game data and is not part of the repository).
param([string]$Package = $env:GAME_PKG, [string]$SimIds = $env:GAME_SIMS_JSON)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'sync/LegacySync.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse errors: $errors" }
foreach ($name in @('Expand-Refpack', 'Read-Exact', 'Get-DbpfIndex', 'Get-DbpfResource', 'Get-JpegSize', 'Crop-JpegCentre', 'Get-GamePortraitCandidates', 'Post-Relay', 'Save-PortraitState', 'Do-GamePortraits')) {
    $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $fn) { throw "missing function $name" }
    Invoke-Expression $fn.Extent.Text
}
$script:fails = 0
function Check([string]$what, $cond, [string]$info = '') { if ($cond) { Write-Host "PASS $what" } else { Write-Host "FAIL $what  $info"; $script:fails++ } }
$script:logs = New-Object System.Collections.Generic.List[string]
function Log([string]$m) { $script:logs.Add($m) }
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Home2 = Join-Path ([IO.Path]::GetTempPath()) ('game-portraits-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Home2 -Force | Out-Null

# ---- refpack, synthetic: literal "abcd" then copy 3 bytes from 4 back ----
$rp = [byte[]](0x10, 0xFB, 0, 0, 7, 0xE0, 0x61, 0x62, 0x63, 0x64, 0x00, 0x03, 0xFC)
$out = Expand-Refpack $rp
Check 'refpack: literal + back-reference' ([Text.Encoding]::ASCII.GetString($out) -eq 'abcdabc') ([Text.Encoding]::ASCII.GetString($out))
$threw = $false; try { [void](Expand-Refpack ([byte[]](0x10, 0xFB, 0, 0, 7, 0x00, 0x03, 0xFC))) } catch { $threw = $true }
Check 'refpack: a copy before any data is refused' $threw
# ---- JPEG size ----
$tiny = [Convert]::FromBase64String('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=')
$sz = Get-JpegSize $tiny
Check 'jpeg size read from the SOF marker' ($sz -and $sz[0] -eq 1 -and $sz[1] -eq 1)
Check 'not a jpeg -> null' ($null -eq (Get-JpegSize ([byte[]](1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13))))
# a missing/garbage package never throws out of Do-GamePortraits
$sims0 = Join-Path $Home2 'sims0'; New-Item -ItemType Directory -Path $sims0 -Force | Out-Null
[IO.File]::WriteAllBytes((Join-Path $sims0 'localthumbcache.package'), [byte[]](1..200 | ForEach-Object { 7 }))
$cfg = [pscustomobject]@{ n = 'Emmy'; k = ('ab' * 32); u = 'https://example.invalid' }
function Post-Relay($cfg, [string]$body, [int]$timeout = 120) { throw 'must not post' }
$script:logs.Clear()
$ok = $true; try { Do-GamePortraits $cfg $sims0 '{"sims":[{"id":"1"}]}' } catch { $ok = $false }
Check 'garbage package: logged, not thrown' ($ok -and ($script:logs -join '|') -match 'portraits failed')

if (-not $Package -or -not (Test-Path -LiteralPath $Package)) {
    Write-Host 'SKIP real-file checks (no sample package given)'
    if ($script:fails) { Write-Host "$script:fails failed"; exit 1 }; exit 0
}

# ---- the real sample ----
$names = @{ '788155645057413751' = 'Sadie'; '788155645058356661' = 'Salim'; '788155645060333511' = 'Romeo'; '788155645059711099' = 'Kyle'; '513436103179450895' = 'Reuben' }
$all = @($names.Keys)
if ($SimIds -and (Test-Path -LiteralPath $SimIds)) { $all = @((Get-Content -LiteralPath $SimIds -Raw | ConvertFrom-Json).PSObject.Properties.Name) ; foreach ($k in $names.Keys) { if ($all -notcontains $k) { $all += $k } } }
$sw = [Diagnostics.Stopwatch]::StartNew()
$c = @(Get-GamePortraitCandidates $Package $all)
Write-Host ("found {0} pictures in {1:n1}s" -f $c.Count, $sw.Elapsed.TotalSeconds)
foreach ($id in '788155645057413751', '788155645058356661', '788155645060333511', '788155645059711099') {
    $x = $c | Where-Object { $_.simId -eq $id } | Select-Object -First 1
    Check ("portrait found for " + $names[$id]) ($null -ne $x)
    if ($x) {
        $b = $x.bytes
        Check ($names[$id] + ': valid JPEG, <= 60 KB') ($b[0] -eq 0xFF -and $b[1] -eq 0xD8 -and $b[$b.Length - 2] -eq 0xFF -and $b[$b.Length - 1] -eq 0xD9 -and $b.Length -le 60000 -and (Get-JpegSize $b) -ne $null) ("len " + $b.Length)
        Check ($names[$id] + ': size and key recorded') ($x.w -gt 0 -and $x.h -gt 0 -and $x.key -match '^[0-9a-f]{8}:[0-9a-f]{8}:[0-9a-f]{16}$') ($x.key)
        $shaNow = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)) -replace '-', '').ToLower()
        Check ($names[$id] + ': sha matches the bytes') ($shaNow -eq $x.sha)
        Write-Host ("   {0}: {1} {2}x{3} {4} bytes" -f $names[$id], $x.key, $x.w, $x.h, $b.Length)
    }
}
Check 'none for Reuben' (-not ($c | Where-Object { $_.simId -eq '513436103179450895' }))
Check 'only sims from the snapshot list come back' (@($c | Where-Object { $all -notcontains $_.simId }).Count -eq 0)
Check 'a sim that is not asked for is not returned' (@(Get-GamePortraitCandidates $Package @('1')).Count -eq 0)
if ($env:GAME_DUMP_DIR) { New-Item -ItemType Directory -Force -Path $env:GAME_DUMP_DIR | Out-Null; foreach ($x in $c) { [IO.File]::WriteAllBytes((Join-Path $env:GAME_DUMP_DIR ($x.simId + '.jpg')), $x.bytes) } }

# ---- upload through a mocked relay ----
$sims = Join-Path $Home2 'sims'; New-Item -ItemType Directory -Path $sims -Force | Out-Null
Copy-Item -LiteralPath $Package -Destination (Join-Path $sims 'localthumbcache.package')
$snapText = '{"v":6,"household":{"id":"55"},"sims":[' + (($all | ForEach-Object { '{"id":"' + $_ + '","first":"x"}' }) -join ',') + ']}'
$script:posts = New-Object System.Collections.Generic.List[string]
function Post-Relay($cfg, [string]$body, [int]$timeout = 120) {
    $script:posts.Add($body)
    $req = $body | ConvertFrom-Json
    return [pscustomobject]@{ ok = $true; stored = $req.items.Count; results = @($req.items | ForEach-Object { [pscustomobject]@{ simId = $_.simId; st = 'stored' } }) }
}
Remove-Item -LiteralPath (Join-Path $Home2 'portraits.json') -Force -ErrorAction SilentlyContinue
$script:logs.Clear()
Do-GamePortraits $cfg $sims $snapText
Check 'one request made' ($script:posts.Count -eq 1)
$req = $script:posts[0] | ConvertFrom-Json
Check 'body: want, name, key' ($req.want -eq 'portraits' -and $req.n -eq 'Emmy' -and $req.k -eq ('ab' * 32))
Check 'body: want is near the start (the relay looks at the first 400 characters)' ($script:posts[0].IndexOf('"want":"portraits"') -lt 300)
$expectN = [Math]::Min(6, $c.Count)
Check 'body: up to 6 items' ($req.items.Count -eq $expectN) ("items " + $req.items.Count)
$good = $true
foreach ($it in $req.items) {
    $by = [Convert]::FromBase64String($it.img)
    $ref = $c | Where-Object { $_.simId -eq $it.simId } | Select-Object -First 1
    if (-not $ref -or $it.sha -ne $ref.sha -or $it.key -ne $ref.key -or $it.w -ne $ref.w -or $it.h -ne $ref.h -or $by.Length -ne $ref.bytes.Length -or $by[0] -ne 0xFF -or $by.Length -gt 60000) { $good = $false }
    if ($it.simId -notmatch '^\d+$') { $good = $false }
}
Check 'body: every item has simId, valid base64 JPEG, w, h, key and sha that match' $good
Check 'body is under the relay limit' ($script:posts[0].Length -lt 560000)
Check 'state saved' (Test-Path -LiteralPath (Join-Path $Home2 'portraits.json'))
$n1 = $script:posts.Count
Do-GamePortraits $cfg $sims $snapText
Check 'not again within the hour' ($script:posts.Count -eq $n1)
# pretend an hour passed
function Age-State { $f = Join-Path $Home2 'portraits.json'; $j = [IO.File]::ReadAllText($f) | ConvertFrom-Json; $j.at = [string]([DateTime]::UtcNow.Ticks - 40000000000); [IO.File]::WriteAllText($f, ($j | ConvertTo-Json -Depth 5 -Compress)) }
Age-State
Do-GamePortraits $cfg $sims $snapText
if ($c.Count -gt 6) {
    Check 'next hour: the next batch (leftovers continue though the file did not change)' ($script:posts.Count -eq $n1 + 1)
    $req2 = $script:posts[$script:posts.Count - 1] | ConvertFrom-Json
    $ids1 = @($req.items | ForEach-Object { $_.simId }); $ids2 = @($req2.items | ForEach-Object { $_.simId })
    Check 'next batch holds other sims (already sent shas are skipped)' (@($ids2 | Where-Object { $ids1 -contains $_ }).Count -eq 0)
    for ($i = 0; $i -lt 20; $i++) { Age-State; Do-GamePortraits $cfg $sims $snapText }
}
$nAll = $script:posts.Count
$sent = 0; foreach ($p in $script:posts) { $sent += @(($p | ConvertFrom-Json).items).Count }
Check 'every picture was sent exactly once' ($sent -eq $c.Count) "sent $sent of $($c.Count)"
Age-State; Do-GamePortraits $cfg $sims $snapText
Check 'once everything is sent and the file is unchanged: nothing more' ($script:posts.Count -eq $nAll)
# the file changes (new mtime) but nothing new inside: no upload, no error
(Get-Item -LiteralPath (Join-Path $sims 'localthumbcache.package')).LastWriteTimeUtc = [DateTime]::UtcNow
Age-State; Do-GamePortraits $cfg $sims $snapText
Check 'changed file with the same pictures: nothing re-sent' ($script:posts.Count -eq $nAll)
# batches of 2: leftovers continue on later hours even though the file did not change
Remove-Item -LiteralPath (Join-Path $Home2 'portraits.json') -Force
$script:posts.Clear()
Do-GamePortraits $cfg $sims $snapText 2
Check 'batch of 2: first request has 2 items' ($script:posts.Count -eq 1 -and @(($script:posts[0] | ConvertFrom-Json).items).Count -eq 2)
Do-GamePortraits $cfg $sims $snapText 2
Check 'batch of 2: not again within the hour' ($script:posts.Count -eq 1)
for ($i = 0; $i -lt 8; $i++) { Age-State; Do-GamePortraits $cfg $sims $snapText 2 }
$seen = @(); foreach ($p in $script:posts) { $seen += @(($p | ConvertFrom-Json).items | ForEach-Object { $_.simId }) }
Check 'batch of 2: all pictures arrive, none twice' ($seen.Count -eq $c.Count -and @($seen | Select-Object -Unique).Count -eq $c.Count) ("seen " + $seen.Count)
# a failing relay is logged, never thrown, and retried later
Remove-Item -LiteralPath (Join-Path $Home2 'portraits.json') -Force
function Post-Relay($cfg, [string]$body, [int]$timeout = 120) { throw 'network down' }
$script:logs.Clear(); $ok = $true
try { Do-GamePortraits $cfg $sims $snapText } catch { $ok = $false }
Check 'relay failure: logged, not thrown' ($ok -and ($script:logs -join '|') -match 'portraits failed: network down')
function Post-Relay($cfg, [string]$body, [int]$timeout = 120) { $script:posts.Add($body); [pscustomobject]@{ ok = $true; results = @() } }
Age-State
$before = $script:posts.Count; Do-GamePortraits $cfg $sims $snapText
Check 'after a failure it tries again in the next hour' ($script:posts.Count -eq $before + 1)
Remove-Item -LiteralPath $Home2 -Recurse -Force -ErrorAction SilentlyContinue
if ($script:fails) { Write-Host "$script:fails failed"; exit 1 }
Write-Host 'all passed'
