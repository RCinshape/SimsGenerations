<#
  LegacySync.ps1 (v3, PC sync) - runs every 5 minutes and at log on. Sends the game file only if something changed,
  plus the game's newest log lines (LegacySync\mod.log), so the host sees problems on the Health page.
  Also reports whether The Sims has switched mods off (it does that after every game update),
  so the app can tell the player what to do. Safe to run any number of times.
#>
$ErrorActionPreference = 'Stop'
$UploaderVersion = 7
$PubN = 'a38bfc9356b75c8da62537cd06da09371a21620e058c7f1a70c1b10cb0f35942c28dc962e2063e989131b21e54a28d12aec35543184e06ffe108d2c621c0437c5265260536fc681f039639975755d3e77673042ad3c34b84afc1bac9e7f95f14a6880c80bb0d5c668055e694b3bf7eb641221e1a944d94d112a392570c7f2842d65692ae18322a9804de5061c0bc7b8abadd29bc616c959490459d6e02a0cfabc553f47817e91751ad2855f63f4ca29ca73fa83dd37c6ee0a0134296ba361318b9064de9933c322f086703d25b55b4387b1354bca387e4c688490c8c71afad5a592f8714671f88964eeca288086dc690fb1335ee9dc7bc1160c468a99f8bbbe96d7bb4af16a737d8646b926995a4e8127af755fd8ff6fc96bea4b16ec4731f9822cc05949b1bafa4fb4adf36ee9f45fb6fea8ab822a9835242c3e94aa29fba00f618e30a6789267bd4edb60036b0585f56e0e13b573967a34b5b51582a16c8c0668e810fbc13c5decc79a5438151e62f651299511be97dc00ac2716eaa675ed9'      # public key (hex) for signed updates; the build fills it in
$Home2  = Join-Path $env:LOCALAPPDATA 'TwentyGenSync'
$Config = Join-Path $Home2 'config.json'
$State  = Join-Path $Home2 'state.json'
$LogF   = Join-Path $Home2 'sync.log'
$Utf8   = New-Object System.Text.UTF8Encoding $false

function Log([string]$m) {
    try {
        if ((Test-Path -LiteralPath $LogF) -and (Get-Item -LiteralPath $LogF).Length -gt 200KB) { Remove-Item -LiteralPath $LogF -Force }
        [IO.File]::AppendAllText($LogF, ("{0:s} {1}`r`n" -f (Get-Date), $m), $Utf8)
    } catch {}
}
# The Sims 4 user folder: Documents\Electronic Arts\<The Sims 4 in any language>, the one that has Options.ini or Mods.
function Find-SimsFolder {
    $roots = @([Environment]::GetFolderPath('MyDocuments'), (Join-Path $env:USERPROFILE 'Documents'), (Join-Path $env:USERPROFILE 'OneDrive\Documents')) | Select-Object -Unique
    foreach ($r in $roots) {
        $ea = Join-Path $r 'Electronic Arts'
        if (-not (Test-Path -LiteralPath $ea)) { continue }
        $best = Get-ChildItem -LiteralPath $ea -Directory -ErrorAction SilentlyContinue |
                Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName 'Options.ini')) -or (Test-Path -LiteralPath (Join-Path $_.FullName 'Mods')) } |
                Sort-Object { -[int](Test-Path -LiteralPath (Join-Path $_.FullName 'LegacySync')) }, { -(Get-Item -LiteralPath $_.FullName).LastWriteTime.Ticks } |
                Select-Object -First 1
        if ($best) { return $best.FullName }
    }
    return $null
}
# ---- signed self-update: new mod parts (+ this script). Nothing is installed unless the signature is right. ----
function Get-PendingUpdate($cfg) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $req = '{"n":' + ($cfg.n | ConvertTo-Json -Compress) + ',"k":' + ($cfg.k | ConvertTo-Json -Compress) + ',"want":"update"}'
    return Invoke-RestMethod -Method Post -Uri $cfg.u -Body ($Utf8.GetBytes($req)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
}
function Handle-Unchanged($cfg, $sims, $st, [string]$hash, [int]$logCount) {
    $bundle = if ($st -and $st.bundle) { [int]$st.bundle } else { 0 }
    $installed = $false
    if ($sims -and (Test-Path -LiteralPath $sims)) {
        try {
            $r = Get-PendingUpdate $cfg
            if ($r.update -and [int]$r.update.v -gt $bundle) {
                $v = [int]$r.update.v
                if (Try-Update $v $cfg $sims $st $r.update) { $bundle = $v; $installed = $true }
            }
        } catch { Log ("ERRO update failed: " + $_.Exception.Message) }
    }
    if ($installed -or ($st -and [int]$st.lines -ne $logCount)) {
        [IO.File]::WriteAllText($State, ('{"hash":' + ($hash | ConvertTo-Json -Compress) + ',"lines":' + $logCount + ',"bundle":' + $bundle + ',"at":"' + (Get-Date).ToString('s') + '"}'), $Utf8)
    }
}
function Hex-Bytes([string]$h) { $b = New-Object byte[] ($h.Length / 2); for ($i = 0; $i -lt $b.Length; $i++) { $b[$i] = [Convert]::ToByte($h.Substring($i * 2, 2), 16) }; return ,$b }
function Try-Update([int]$v, $cfg, $sims, $st, $b = $null) {
    if ($PubN.StartsWith('__')) { return $false }
    if ($st -and $st.bundle -and [int]$st.bundle -ge $v) { return $false }
    if (-not $b) {
        $r = Get-PendingUpdate $cfg
        $b = $r.update
    }
    if (-not $b -or [int]$b.v -ne $v) { Log "update v$v is not there"; return $false }
    $names = [string[]]@($b.files.PSObject.Properties.Name); [Array]::Sort($names, [StringComparer]::Ordinal)
    $sha = [System.Security.Cryptography.SHA256]::Create(); $text = "TGUPD1`n$v`n"; $files = @{}
    foreach ($n in $names) {
        if ($n -notmatch '^(twentygen_[a-z]+\.pyc|uploader\.ps1)$') { Log "ERRO update v$v REFUSED: unexpected file $n"; return $false }
        $by = [Convert]::FromBase64String([string]$b.files.$n); $files[$n] = $by
        $text += $n + "`n" + ([BitConverter]::ToString($sha.ComputeHash($by)) -replace '-', '').ToLower() + "`n"
    }
    if (-not $files.ContainsKey('twentygen_sync.pyc') -or -not $files.ContainsKey('twentygen_net.pyc')) { Log "ERRO update v$v REFUSED: incomplete"; return $false }
    $rsa = [System.Security.Cryptography.RSA]::Create()
    $p = New-Object System.Security.Cryptography.RSAParameters; $p.Modulus = (Hex-Bytes $PubN); $p.Exponent = [byte[]](1, 0, 1); $rsa.ImportParameters($p)
    $ok = $rsa.VerifyData($Utf8.GetBytes($text), [Convert]::FromBase64String([string]$b.sig), [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    if (-not $ok) { Log "ERRO update v$v REFUSED: the signature is not right. Nothing was changed."; return $false }
    # her mod file in Mods: keep her config.json, swap the game parts
    $mods = Join-Path $sims 'Mods'
    $cur = @(Get-ChildItem -LiteralPath $mods -Filter '*.ts4script' -File -Recurse -Depth 1 -ErrorAction SilentlyContinue | Where-Object { ($_.Name -replace '[-_ ]', '') -match 'twentygen' } | Sort-Object LastWriteTime -Descending)
    if (-not $cur.Count) { Log "update v${v}: no game file in Mods; run the installer"; return $false }
    $target = $cur[0].FullName
    Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
    $cfgBytes = $null
    $zin = New-Object IO.Compression.ZipArchive((New-Object IO.MemoryStream(, [IO.File]::ReadAllBytes($target))), ([IO.Compression.ZipArchiveMode]::Read))
    foreach ($e in $zin.Entries) { if ($e.FullName -eq 'config.json') { $ms0 = New-Object IO.MemoryStream; $s0 = $e.Open(); $s0.CopyTo($ms0); $s0.Close(); $cfgBytes = $ms0.ToArray() } }
    $zin.Dispose()
    $ms = New-Object IO.MemoryStream
    $zout = New-Object IO.Compression.ZipArchive($ms, ([IO.Compression.ZipArchiveMode]::Create), $true)
    foreach ($n in $names) { if ($n -like '*.pyc') { $w = $zout.CreateEntry($n).Open(); $w.Write($files[$n], 0, $files[$n].Length); $w.Close() } }
    if ($cfgBytes) { $w = $zout.CreateEntry('config.json').Open(); $w.Write($cfgBytes, 0, $cfgBytes.Length); $w.Close() }
    $zout.Dispose()
    try {
        Copy-Item -LiteralPath $target -Destination (Join-Path $Home2 'backup-mod.ts4script.bak') -Force
        [IO.File]::WriteAllBytes($target + '.new', $ms.ToArray())
        Move-Item -LiteralPath ($target + '.new') -Destination $target -Force
    } catch {
        Remove-Item -LiteralPath ($target + '.new') -Force -ErrorAction SilentlyContinue
        Log "update v$v waits: the game file is in use (it tries again in 5 minutes)"; return $false
    }
    if ($files.ContainsKey('uploader.ps1')) { [IO.File]::WriteAllBytes((Join-Path $Home2 'LegacySync.ps1'), $files['uploader.ps1']) }
    Log "updated to v$v (signature checked). It starts the next time The Sims 4 starts."
    return $true
}
# ---- the group: messages + chaos for the game (inbox), and screenshots she named "share..." ----
function Shrink-Win([string]$path) {           # Windows only (System.Drawing): max 1600 px, JPEG quality 82
    Add-Type -AssemblyName System.Drawing
    $img = [System.Drawing.Image]::FromFile($path)
    $scale = [Math]::Min(1.0, 1600 / [Math]::Max($img.Width, $img.Height))
    $w = [int]($img.Width * $scale); $h = [int]($img.Height * $scale)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose(); $img.Dispose()
    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]82)
    $ms = New-Object IO.MemoryStream; $bmp.Save($ms, $codec, $ep); $bmp.Dispose()
    return ,$ms.ToArray()
}
function Shrink-Image([string]$path) {
    $raw = $null; try { $raw = [IO.File]::ReadAllBytes($path) } catch { return $null }
    if ($PSVersionTable.PSEdition -eq 'Desktop' -or $IsWindows) {
        try { $small = Shrink-Win $path; if ($small -and $small.Length -le 1000000) { return [Convert]::ToBase64String($small) } } catch { Log ("image resize failed: " + $_.Exception.Message) }
    }
    if ($raw.Length -le 1000000) { return [Convert]::ToBase64String($raw) }      # small enough as it is
    return $null
}
function Add-InboxRecords([object]$node, [System.Collections.Generic.List[object]]$records, [int]$depth = 0) {
    if ($null -eq $node -or $depth -gt 32) { return }
    if ($node -is [array]) { foreach ($entry in $node) { Add-InboxRecords $entry $records ($depth + 1) }; return }
    if ($node -isnot [System.Management.Automation.PSCustomObject]) { return }
    $props = @($node.PSObject.Properties.Name)
    if ($props.Count -eq 2 -and $props -contains 'value' -and $props -contains 'Count' -and -not $node.PSObject.Properties['id'] -and $node.value -is [array]) {
        $wrapperCount = 0
        if ([int]::TryParse([string]$node.Count, [ref]$wrapperCount) -and $wrapperCount -eq $node.value.Count) { Add-InboxRecords $node.value $records ($depth + 1); return }
    }
    $idProperty = $node.PSObject.Properties['id']
    if ($idProperty -and -not [string]::IsNullOrWhiteSpace([string]$idProperty.Value)) { $records.Add($node) }
}
function Do-Social($cfg, $sims) {
    if (-not $sims) { return }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $who = '{"n":' + ($cfg.n | ConvertTo-Json -Compress) + ',"k":' + ($cfg.k | ConvertTo-Json -Compress)
    $sf = Join-Path $Home2 'social.json'; $so = $null
    if (Test-Path -LiteralPath $sf) { try { $so = [IO.File]::ReadAllText($sf, $Utf8) | ConvertFrom-Json } catch {} }
    $since = if ($so -and $so.since) { [double]$so.since } else { 0 }
    $sent = @(); if ($so -and $so.shots) { $sent = @($so.shots) }
    try {
        $r = Invoke-RestMethod -Method Post -Uri $cfg.u -Body ($Utf8.GetBytes($who + ',"want":"inbox","since":' + $since + '}')) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
        $items = @(); if ($r.ok -and $r.inbox) { $items = @($r.inbox) }
        if ($items.Count) {
            $ibf = Join-Path $sims 'LegacySync\inbox.json'
            $oldRecords = New-Object 'System.Collections.Generic.List[object]'
            if (Test-Path -LiteralPath $ibf) { try { $oldRaw = [IO.File]::ReadAllText($ibf, $Utf8) | ConvertFrom-Json; Add-InboxRecords $oldRaw $oldRecords } catch {} }
            $old = $oldRecords.ToArray()
            $newRecords = New-Object 'System.Collections.Generic.List[object]'
            Add-InboxRecords $items $newRecords
            $newItems = $newRecords.ToArray()
            $all = @(@($old) + @($newItems) | Select-Object -Last 40)
            [IO.File]::WriteAllText($ibf, (ConvertTo-Json -InputObject $all -Depth 4 -Compress), $Utf8)
            $since = [double](($items | Measure-Object -Property at -Maximum).Maximum)
            Log ("inbox: " + $items.Count + " new")
        }
    } catch { Log ("inbox failed: " + $_.Exception.Message) }
    try {
        $shotDir = Join-Path $sims 'Screenshots'
        if (Test-Path -LiteralPath $shotDir) {
            $files = @(Get-ChildItem -LiteralPath $shotDir -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'share' -and $_.Extension -match '^\.(png|jpe?g)$' } | Sort-Object LastWriteTime)
            foreach ($f in $files) {
                if ($sent -contains $f.Name) { continue }
                $sent += $f.Name
                if ($f.Length -gt 25MB) { continue }
                $b64 = Shrink-Image $f.FullName
                if (-not $b64) { continue }
                $r = Invoke-RestMethod -Method Post -Uri $cfg.u -Body ($Utf8.GetBytes($who + ',"want":"shot","name":' + ($f.Name | ConvertTo-Json -Compress) + ',"img":"' + $b64 + '"}')) -ContentType 'application/json; charset=utf-8' -TimeoutSec 120
                Log ("screenshot " + $f.Name + ": " + $(if ($r.ok) { 'shared' } else { [string]$r.error }))
                break                                   # one picture per run (every 5 minutes)
            }
        }
    } catch { Log ("screenshot failed: " + $_.Exception.Message) }
    $sent = @($sent | Select-Object -Last 300)
    $sj = '[' + ((@($sent) | ForEach-Object { ([string]$_) | ConvertTo-Json -Compress }) -join ',') + ']'
    [IO.File]::WriteAllText($sf, ('{"since":' + [double]$since + ',"shots":' + $sj + '}'), $Utf8)
}
# ---- game portraits: pictures of her sims from the game's own thumbnail cache (localthumbcache.package, DBPF 2) ----
# At most once an hour, and only when that file changed. Any failure is logged and skipped: it never touches the normal upload.
function Expand-Refpack([byte[]]$s) {            # EA "refpack" (QFS) decompressor
    $p = 2
    $flags = ([int]$s[0] -shl 8) -bor [int]$s[1]
    $big = (($flags -band 0x8000) -ne 0)
    if (($flags -band 0x0100) -ne 0) { if ($big) { $p += 4 } else { $p += 3 } }
    [int64]$n = 0
    if ($big) { $n = ([int64]$s[$p] -shl 24) -bor ([int64]$s[$p + 1] -shl 16) -bor ([int64]$s[$p + 2] -shl 8) -bor [int64]$s[$p + 3]; $p += 4 }
    else { $n = ([int64]$s[$p] -shl 16) -bor ([int64]$s[$p + 1] -shl 8) -bor [int64]$s[$p + 2]; $p += 3 }
    if ($n -le 0 -or $n -gt 67108864) { throw 'refpack: bad size' }
    $o = New-Object byte[] ([int]$n)
    $q = 0; $len = $s.Length; $size = [int]$n
    while ($p -lt $len) {
        $c = [int]$s[$p]; $p++
        $nl = 0; $ln = 0; $off = 0
        if ($c -lt 0x80) {
            $b1 = [int]$s[$p]; $p++
            $nl = $c -band 3; $ln = (($c -band 0x1c) -shr 2) + 3; $off = (($c -band 0x60) -shl 3) + $b1 + 1
        } elseif ($c -lt 0xc0) {
            $b1 = [int]$s[$p]; $b2 = [int]$s[$p + 1]; $p += 2
            $nl = $b1 -shr 6; $ln = ($c -band 0x3f) + 4; $off = (($b1 -band 0x3f) -shl 8) + $b2 + 1
        } elseif ($c -lt 0xe0) {
            $b1 = [int]$s[$p]; $b2 = [int]$s[$p + 1]; $b3 = [int]$s[$p + 2]; $p += 3
            $nl = $c -band 3; $ln = (($c -band 0x0c) -shl 6) + $b3 + 5; $off = (($c -band 0x10) -shl 12) + ($b1 -shl 8) + $b2 + 1
        } elseif ($c -lt 0xfc) {
            $nl = (($c -band 0x1f) -shl 2) + 4
        } else {
            $nl = $c -band 3
        }
        if ($nl -gt 0) {
            if (($p + $nl) -gt $len -or ($q + $nl) -gt $size) { throw 'refpack: literal out of range' }
            [Array]::Copy($s, $p, $o, $q, $nl); $p += $nl; $q += $nl
        }
        if ($ln -gt 0) {
            if ($off -gt $q -or ($q + $ln) -gt $size) { throw 'refpack: copy out of range' }
            for ($i = 0; $i -lt $ln; $i++) { $o[$q] = $o[$q - $off]; $q++ }
        }
        if ($c -ge 0xfc) { break }
    }
    if ($q -ne $size) { throw 'refpack: short output' }
    return ,$o
}
function Read-Exact([IO.Stream]$fs, [int64]$pos, [int]$count) {
    if ($count -lt 0 -or $pos -lt 0 -or ($pos + $count) -gt $fs.Length) { throw 'read outside the file' }
    [void]$fs.Seek($pos, [IO.SeekOrigin]::Begin)
    $buf = New-Object byte[] $count; $got = 0
    while ($got -lt $count) { $r = $fs.Read($buf, $got, $count - $got); if ($r -le 0) { throw 'short read' }; $got += $r }
    return ,$buf
}
function Get-DbpfIndex([IO.Stream]$fs) {         # key "type:group:instance" -> @{ t; off; size; comp }
    $h = Read-Exact $fs 0 96
    if ([Text.Encoding]::ASCII.GetString($h, 0, 4) -ne 'DBPF') { throw 'not a DBPF package' }
    $cnt = [int64][BitConverter]::ToUInt32($h, 36)
    $ipos = [int64][BitConverter]::ToUInt32($h, 64)
    if ($ipos -eq 0) { $ipos = [int64][BitConverter]::ToUInt64($h, 0x28) }
    if ($cnt -gt 300000 -or $ipos -le 0 -or $ipos -ge $fs.Length) { throw 'bad package index' }
    $take = [int][Math]::Min($cnt * 32 + 16, $fs.Length - $ipos)
    $d = Read-Exact $fs $ipos $take
    $flags = [BitConverter]::ToUInt32($d, 0); $p = 4
    $const = New-Object 'uint32[]' 3; $isConst = New-Object 'bool[]' 3
    for ($b = 0; $b -lt 3; $b++) { if (($flags -shr $b) -band 1) { $const[$b] = [BitConverter]::ToUInt32($d, $p); $isConst[$b] = $true; $p += 4 } }
    $idx = @{}
    for ($i = 0; $i -lt $cnt; $i++) {
        $v = New-Object 'uint32[]' 3
        for ($b = 0; $b -lt 3; $b++) { if ($isConst[$b]) { $v[$b] = $const[$b] } else { $v[$b] = [BitConverter]::ToUInt32($d, $p); $p += 4 } }
        $il = [BitConverter]::ToUInt32($d, $p); $off = [BitConverter]::ToUInt32($d, $p + 4); $sz = [BitConverter]::ToUInt32($d, $p + 8)
        $comp = [BitConverter]::ToUInt16($d, $p + 16); $p += 20
        $inst = ([uint64]$v[2] -shl 32) -bor [uint64]$il
        $key = '{0:x8}:{1:x8}:{2:x16}' -f $v[0], $v[1], $inst
        $idx[$key] = @{ t = $v[0]; off = [int64]$off; size = [int64]($sz -band 0x7fffffff); comp = [int]$comp }
    }
    return $idx
}
function Get-DbpfResource([IO.Stream]$fs, $e) {
    $raw = Read-Exact $fs $e.off ([int]$e.size)
    if ($e.comp -eq 0) { return ,$raw }
    if ($e.comp -eq 0xFFFF -or $e.comp -eq 0xFFFE) { return ,(Expand-Refpack $raw) }
    if ($e.comp -eq 0x5A42) {
        $ms = New-Object IO.MemoryStream (, $raw); [void]$ms.Seek(2, [IO.SeekOrigin]::Begin)
        $ds = New-Object IO.Compression.DeflateStream ($ms, [IO.Compression.CompressionMode]::Decompress)
        $out = New-Object IO.MemoryStream; $ds.CopyTo($out); $ds.Dispose()
        return ,$out.ToArray()
    }
    throw ('unknown compression 0x{0:x}' -f $e.comp)
}
function Get-JpegSize([byte[]]$b) {              # @(width, height) from the first SOF marker, or $null when it is not a JPEG
    if ($b.Length -lt 12 -or $b[0] -ne 0xFF -or $b[1] -ne 0xD8 -or $b[2] -ne 0xFF) { return $null }
    $p = 2
    while (($p + 9) -lt $b.Length) {
        if ($b[$p] -ne 0xFF) { return $null }
        $m = [int]$b[$p + 1]
        if ($m -eq 0xFF) { $p++; continue }
        if ($m -ge 0xC0 -and $m -le 0xCF -and $m -ne 0xC4 -and $m -ne 0xC8 -and $m -ne 0xCC) {
            return @((([int]$b[$p + 7] -shl 8) -bor [int]$b[$p + 8]), (([int]$b[$p + 5] -shl 8) -bor [int]$b[$p + 6]))
        }
        if ($m -eq 0xD8 -or ($m -ge 0xD0 -and $m -le 0xD7) -or $m -eq 0x01) { $p += 2; continue }
        $p += 2 + (([int]$b[$p + 2] -shl 8) -bor [int]$b[$p + 3])
    }
    return $null
}
function Crop-JpegCentre([byte[]]$jpg, [double]$frac, [int]$maxBytes) {     # centre 70% (drops the white corners); $null when System.Drawing is not usable
    Add-Type -AssemblyName System.Drawing
    $img = $null; $bmp = $null; $g = $null
    try {
        $img = [System.Drawing.Image]::FromStream((New-Object IO.MemoryStream (, $jpg)))
        $cw = [int][Math]::Round($img.Width * $frac); $ch = [int][Math]::Round($img.Height * $frac)
        $x = [int][Math]::Floor(($img.Width - $cw) / 2); $y = [int][Math]::Floor(($img.Height - $ch) / 2)
        $bmp = New-Object System.Drawing.Bitmap $cw, $ch
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $cw, $ch), $x, $y, $cw, $ch, [System.Drawing.GraphicsUnit]::Pixel)
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        foreach ($qual in 90, 82, 72, 60) {
            $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
            $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([long]$qual)
            $ms = New-Object IO.MemoryStream; $bmp.Save($ms, $codec, $ep)
            if ($ms.Length -le $maxBytes) { return ,$ms.ToArray() }
        }
        return $null
    } finally { if ($g) { $g.Dispose() }; if ($bmp) { $bmp.Dispose() }; if ($img) { $img.Dispose() } }
}
function Get-GamePortraitCandidates([string]$pkg, [string[]]$wanted, [int]$maxBytes = 60000) {
    $want = @{}; foreach ($w in $wanted) { if ($w) { $want[$w] = $true } }
    $fs = [IO.File]::Open($pkg, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $idx = Get-DbpfIndex $fs
        $owners = @{}                              # sim id -> list of index keys
        foreach ($mk in @($idx.Keys | Where-Object { $_.StartsWith('b93a9915:') })) {
            $m = $null; try { $m = Get-DbpfResource $fs $idx[$mk] } catch { Log ("portraits: manifest unreadable: " + $_.Exception.Message); continue }
            $last = $m.Length - 45
            for ($p = 0; $p -le $last; $p++) {
                if ($m[$p] -ne $m[$p + 17]) { continue }
                $same = $true
                for ($j = 1; $j -lt 12; $j++) { if ($m[$p + $j] -ne $m[$p + 17 + $j]) { $same = $false; break } }
                if (-not $same) { continue }
                $owner = [BitConverter]::ToUInt64($m, $p).ToString()
                if (-not $want.ContainsKey($owner)) { continue }
                $key = '{0:x8}:{1:x8}:{2:x16}' -f [BitConverter]::ToUInt32($m, $p + 29), [BitConverter]::ToUInt32($m, $p + 33), [BitConverter]::ToUInt64($m, $p + 37)
                if (-not $idx.ContainsKey($key)) { continue }
                if (-not $owners.ContainsKey($owner)) { $owners[$owner] = New-Object 'System.Collections.Generic.List[string]' }
                if (-not $owners[$owner].Contains($key)) { $owners[$owner].Add($key) }
            }
        }
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $res = New-Object 'System.Collections.Generic.List[object]'
        foreach ($id in $wanted) {
            if (-not $owners.ContainsKey($id)) { continue }
            try {
                $best = $null                      # prefer the clean head icons (E18CAEE2), else the 256 px bust (needs a crop); the largest of its kind
                foreach ($group in @('e18caee2'), @('16ccf748', '4d5b0931')) {
                    foreach ($key in $owners[$id]) {
                        if ($group -notcontains $key.Substring(0, 8)) { continue }
                        $by = $null; try { $by = Get-DbpfResource $fs $idx[$key] } catch { continue }
                        $sz = Get-JpegSize $by; if (-not $sz) { continue }
                        $area = $sz[0] * $sz[1]
                        if (-not $best -or $area -gt $best.area) { $best = @{ kind = $group[0]; key = $key; bytes = $by; w = $sz[0]; h = $sz[1]; area = $area } }
                    }
                    if ($best) { break }
                }
                if (-not $best) { continue }
                $bytes = $best.bytes; $w = $best.w; $h = $best.h
                if ($best.kind -ne 'e18caee2') {
                    $c = $null; try { $c = Crop-JpegCentre $bytes 0.7 $maxBytes } catch { $c = $null }
                    if ($c) { $bytes = $c; $sz2 = Get-JpegSize $bytes; if ($sz2) { $w = $sz2[0]; $h = $sz2[1] } }
                }
                $n = $bytes.Length
                if ($n -lt 4 -or $n -gt $maxBytes -or $bytes[$n - 2] -ne 0xFF -or $bytes[$n - 1] -ne 0xD9) { continue }
                $hex = ([BitConverter]::ToString($sha.ComputeHash($bytes)) -replace '-', '').ToLower()
                $res.Add([pscustomobject]@{ simId = $id; key = $best.key; bytes = $bytes; w = $w; h = $h; sha = $hex })
            } catch { Log ("portraits: sim $id skipped: " + $_.Exception.Message) }
        }
        $sha.Dispose()
        return $res.ToArray()
    } finally { $fs.Dispose() }
}
function Post-Relay($cfg, [string]$body, [int]$timeout = 120) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    return Invoke-RestMethod -Method Post -Uri $cfg.u -Body ($Utf8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec $timeout
}
function Save-PortraitState([string]$file, [string]$mtime, [bool]$pending, $sent) {
    $names = @($sent.Keys | Select-Object -Last 1500)
    $pairs = @($names | ForEach-Object { ([string]$_ | ConvertTo-Json -Compress) + ':' + ([string]$sent[$_] | ConvertTo-Json -Compress) })
    $json = '{"mtime":"' + $mtime + '","at":"' + [DateTime]::UtcNow.Ticks + '","pending":' + $pending.ToString().ToLower() + ',"sent":{' + ($pairs -join ',') + '}}'
    [IO.File]::WriteAllText($file, $json, $Utf8)
}
function Do-GamePortraits($cfg, $sims, [string]$snapText, [int]$maxItems = 6) {
    if (-not $sims -or -not $snapText) { return }
    $pkg = Join-Path $sims 'localthumbcache.package'
    if (-not (Test-Path -LiteralPath $pkg)) { return }
    $sf = Join-Path $Home2 'portraits.json'; $so = $null
    if (Test-Path -LiteralPath $sf) { try { $so = [IO.File]::ReadAllText($sf, $Utf8) | ConvertFrom-Json } catch {} }
    $mtime = [string](Get-Item -LiteralPath $pkg).LastWriteTimeUtc.Ticks
    $now = [DateTime]::UtcNow.Ticks
    if ($so -and $so.at) {
        $age = $now - [int64]$so.at
        if ($age -ge 0 -and $age -lt 36000000000) { return }                         # at most once an hour
    }
    $pending = [bool]($so -and $so.pending)
    if ($so -and [string]$so.mtime -eq $mtime -and -not $pending) { return }       # the cache did not change
    $sent = @{}; if ($so -and $so.sent) { foreach ($pr in $so.sent.PSObject.Properties) { $sent[$pr.Name] = [string]$pr.Value } }
    try {
        $ids = @(); $snap = $snapText | ConvertFrom-Json
        if ($snap.sims) { $ids = @($snap.sims | ForEach-Object { [string]$_.id } | Where-Object { $_ -match '^\d{1,24}$' } | Select-Object -Unique) }
        $cands = @(); if ($ids.Count) { $cands = @(Get-GamePortraitCandidates $pkg $ids) }
        $todo = @($cands | Where-Object { $sent[$_.simId] -ne $_.sha })
        $batch = @($todo | Select-Object -First $maxItems)
        $stop = $false
        if ($batch.Count) {
            $items = @($batch | ForEach-Object {
                '{"simId":"' + $_.simId + '","img":"' + [Convert]::ToBase64String($_.bytes) + '","w":' + $_.w + ',"h":' + $_.h + ',"key":"' + $_.key + '","sha":"' + $_.sha + '"}' })
            $body = '{"n":' + ($cfg.n | ConvertTo-Json -Compress) + ',"k":' + ($cfg.k | ConvertTo-Json -Compress) + ',"want":"portraits","items":[' + ($items -join ',') + ']}'
            $r = Post-Relay $cfg $body 120
            if (-not $r -or -not $r.ok) { throw ('relay said: ' + $(if ($r) { [string]$r.error } else { 'nothing' })) }
            $tally = @{}
            foreach ($x in @($r.results)) {
                $st = [string]$x.st; if ($tally.ContainsKey($st)) { $tally[$st]++ } else { $tally[$st] = 1 }
                $it = $batch | Where-Object { $_.simId -eq [string]$x.simId } | Select-Object -First 1
                if ($it -and @('limit', 'day_limit') -notcontains $st) { $sent[$it.simId] = $it.sha }
                if ($st -eq 'day_limit' -or $st -eq 'limit') { $stop = $true }
            }
            Log ('portraits: sent ' + $batch.Count + ' (' + (($tally.Keys | Sort-Object | ForEach-Object { $_ + ' ' + $tally[$_] }) -join ', ') + '), ' + [Math]::Max(0, $todo.Count - $batch.Count) + ' waiting')
        } else { Log ('portraits: nothing new (' + $cands.Count + ' pictures found)') }
        $left = $todo.Count - $batch.Count
        Save-PortraitState $sf $mtime ($left -gt 0 -or $stop) $sent
    } catch {
        Log ('portraits failed: ' + $_.Exception.Message)
        try { Save-PortraitState $sf ([string]$(if ($so) { $so.mtime } else { '' })) $true $sent } catch {}     # try again in an hour
    }
}
# ---- end of game portraits ----
function Get-IniFlag([string]$ini, [string]$key) {
    if (-not (Test-Path -LiteralPath $ini)) { return $null }
    $m = [regex]::Match((Get-Content -LiteralPath $ini -Raw), "(?im)^\s*$key\s*=\s*(\d+)")
    if ($m.Success) { return [int]$m.Groups[1].Value } else { return $null }
}

try {
    if (-not (Test-Path -LiteralPath $Config)) { Log 'no config - run the game connector again'; exit 2 }
    $cfg = [IO.File]::ReadAllText($Config, $Utf8) | ConvertFrom-Json
    $sims = Find-SimsFolder
    $snapFile = if ($sims) { Join-Path $sims 'LegacySync\snapshot.json' } else { $null }
    $text = if ($snapFile -and (Test-Path -LiteralPath $snapFile)) { [IO.File]::ReadAllText($snapFile, $Utf8) } else { '{"v":0,"household":{"id":"none"}}' }
    if ($text.Length -gt 300000) { Log 'game file too big, skipped'; exit 0 }
    $ini = if ($sims) { Join-Path $sims 'Options.ini' } else { '' }
    $modsOff   = (Get-IniFlag $ini 'modsdisabled') -eq 1
    $scriptOff = (Get-IniFlag $ini 'scriptmodsenabled') -eq 0
    $modThere  = [bool]($sims -and (Test-Path -LiteralPath (Join-Path $sims 'Mods\TwentyGenLegacy\twentygen_sync.ts4script')))
    if (-not $modThere -and $sims) {
        $modThere = [bool](@(Get-ChildItem -LiteralPath (Join-Path $sims 'Mods') -Filter '*.ts4script' -File -Depth 1 -ErrorAction SilentlyContinue | Where-Object { ($_.Name -replace '[-_]', '') -match 'twentygen' }).Count)
    }
    $meta = '{"up":' + $UploaderVersion + ',"via":"helper","found":' + ([bool]$sims).ToString().ToLower() + ',"mod":' + $modThere.ToString().ToLower() +
            ',"modsOff":' + $modsOff.ToString().ToLower() + ',"scriptOff":' + $scriptOff.ToString().ToLower() + '}'
    # the game's own log: newest 60 lines (the Health page shows them)
    $modLog = if ($sims) { Join-Path $sims 'LegacySync\mod.log' } else { '' }
    $st = $null; if (Test-Path -LiteralPath $State) { try { $st = [IO.File]::ReadAllText($State, $Utf8) | ConvertFrom-Json } catch {} }
    try { Do-Social $cfg $sims } catch { Log ("social failed: " + $_.Exception.Message) }
    try { Do-GamePortraits $cfg $sims $text } catch { Log ("portraits failed: " + $_.Exception.Message) }
    $lines = @(); $logCount = 0
    if ($modLog -and (Test-Path -LiteralPath $modLog)) {
        $allL = @(Get-Content -LiteralPath $modLog -Encoding UTF8); $logCount = $allL.Count
        $from = 0; if ($st -and $st.lines -and [int]$st.lines -le $logCount) { $from = [int]$st.lines }
        # only lines not sent yet; skip "the game can't send by itself" (known, the PC sync does the sending)
        $lines = @($allL | Select-Object -Skip $from | Where-Object { $_ -notmatch 'way did not work|send failed|no way to send' } | Select-Object -Last 60)
    }
    $logMark = $lines -join "`n"
    $own = if (Test-Path -LiteralPath $LogF) { @(Get-Content -LiteralPath $LogF -Tail 3 -Encoding UTF8 | ForEach-Object { "helper: $_" }) } else { @() }
    $osName = ''; try { $osName = [string](Get-CimInstance Win32_OperatingSystem -ErrorAction Stop).Caption } catch {}
    $mv = [regex]::Match($text, '"modVersion":\s*(\d+)'); $modv = if ($mv.Success) { ',"mod":' + $mv.Groups[1].Value } else { '' }
    $env2 = '{"helper":' + $UploaderVersion + ',"cfg":"pc-helper","transport":"pc","ps":"' + $PSVersionTable.PSVersion.ToString() + '","os":' + ($osName | ConvertTo-Json -Compress) + $modv + '}'
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [Convert]::ToBase64String($sha.ComputeHash($Utf8.GetBytes($text + '|' + $meta + '|' + $logMark))); $sha.Dispose()
    $last = if ($st) { $st.hash } else { $null }
    if ($last -eq $hash) {
        Handle-Unchanged $cfg $sims $st $hash $logCount
        exit 0
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $all = @($lines) + @($own)
    $lj = if ($all.Count) { ConvertTo-Json -InputObject ([string[]]$all) -Compress } else { '[]' }
    $body = '{"n":' + ($cfg.n | ConvertTo-Json -Compress) + ',"k":' + ($cfg.k | ConvertTo-Json -Compress) + ',"s":' + ($text | ConvertTo-Json -Compress) + ',"m":' + $meta + ',"l":' + $lj + ',"e":' + $env2 + '}'
    $res = Invoke-RestMethod -Method Post -Uri $cfg.u -Body ($Utf8.GetBytes($body)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60
    if ($res.ok) {
        $bundle = if ($st -and $st.bundle) { [int]$st.bundle } else { 0 }
        Log ("sent ({0} bytes) {1}" -f $text.Length, $meta)
        if ($res.upd -and [int]$res.upd -gt $bundle -and $sims) {
            try { if (Try-Update ([int]$res.upd) $cfg $sims $st) { $bundle = [int]$res.upd } } catch { Log ("ERRO update failed: " + $_.Exception.Message) }
        }
        [IO.File]::WriteAllText($State, ('{"hash":' + ($hash | ConvertTo-Json -Compress) + ',"lines":' + $logCount + ',"bundle":' + $bundle + ',"at":"' + (Get-Date).ToString('s') + '"}'), $Utf8)
        exit 0
    }
    Log ("refused: " + $res.error); exit 3
} catch {
    Log ("error: " + $_.Exception.Message); exit 1
}
