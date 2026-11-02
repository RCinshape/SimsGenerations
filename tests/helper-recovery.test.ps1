# Run with Windows PowerShell 5.1 or PowerShell 7: powershell -File tests/helper-recovery.test.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'sync/LegacySync.ps1'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "parse errors: $errors" }
foreach ($name in @('Get-PendingUpdate', 'Handle-Unchanged', 'Hex-Bytes', 'Try-Update')) {
    $fn = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    if (-not $fn) { throw "missing function $name" }
    Invoke-Expression $fn.Extent.Text
}
function Assert($condition, $message) { if (-not $condition) { throw $message } }
function Log([string]$message) { }
$Utf8 = New-Object System.Text.UTF8Encoding $false
$Home2 = Join-Path ([IO.Path]::GetTempPath()) ('helper-recovery-' + [guid]::NewGuid())
$State = Join-Path $Home2 'state.json'
$sims = Join-Path $Home2 'sims'
$mods = Join-Path $sims 'Mods'
New-Item -ItemType Directory -Path $mods -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$cfg = [pscustomobject]@{ n='test'; k='test'; u='https://example.invalid' }
$script:requests = @()
function Invoke-RestMethod {
    param($Method, $Uri, $Body, $ContentType, $TimeoutSec)
    $request = $Utf8.GetString($Body) | ConvertFrom-Json
    $script:requests += $request
    Assert ($TimeoutSec -gt 0 -and $TimeoutSec -le 60) 'update request must have a bounded timeout'
    Assert ($request.want -eq 'update' -and -not $request.s) 'unexpected snapshot upload'
    return [pscustomobject]@{ update=$script:pending }
}
try {
    $rsa = [System.Security.Cryptography.RSA]::Create()
    $rsa.KeySize = 2048
    $PubN = ([BitConverter]::ToString($rsa.ExportParameters($false).Modulus) -replace '-', '').ToLowerInvariant()
    $parts = [ordered]@{ 'twentygen_net.pyc'=[Convert]::ToBase64String($Utf8.GetBytes('new net')); 'twentygen_sync.pyc'=[Convert]::ToBase64String($Utf8.GetBytes('new sync')) }
    $sha = [Security.Cryptography.SHA256]::Create()
    $canonical = "TGUPD1`n8`n"
    foreach ($name in $parts.Keys) { $canonical += $name + "`n" + (([BitConverter]::ToString($sha.ComputeHash([Convert]::FromBase64String($parts[$name]))) -replace '-', '').ToLowerInvariant()) + "`n" }
    $sig = [Convert]::ToBase64String($rsa.SignData($Utf8.GetBytes($canonical), [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1))
    $script:pending = [pscustomobject]@{ v=8; files=[pscustomobject]$parts; sig=$sig }
    $st = [pscustomobject]@{ hash='same'; lines=0; bundle=7 }
    [IO.File]::WriteAllText($State, ($st | ConvertTo-Json -Compress), $Utf8)
    # Valid update cannot install until the archive exists; the next unchanged run must retry.
    Handle-Unchanged $cfg $sims $st 'same' 0
    Assert ($script:requests.Count -eq 1) 'unchanged run must check once'
    Assert ((Get-Content $State -Raw | ConvertFrom-Json).bundle -eq 7) 'failed install advanced bundle'
    $target = Join-Path $mods 'twentygen.ts4script'
    $ms = New-Object IO.MemoryStream
    $zip = New-Object IO.Compression.ZipArchive($ms, ([IO.Compression.ZipArchiveMode]::Create), $true)
    foreach ($entry in @('config.json', 'twentygen_sync.pyc', 'twentygen_net.pyc')) {
        $w = $zip.CreateEntry($entry).Open(); $bytes = $Utf8.GetBytes('original ' + $entry); $w.Write($bytes, 0, $bytes.Length); $w.Close()
    }
    $zip.Dispose(); [IO.File]::WriteAllBytes($target, $ms.ToArray()); $ms.Dispose()
    # A corrupt signature leaves every byte of the archive untouched.
    $before = [Convert]::ToBase64String([IO.File]::ReadAllBytes($target))
    $script:pending.sig = [Convert]::ToBase64String((New-Object byte[] 256))
    Handle-Unchanged $cfg $sims $st 'same' 0
    Assert ($before -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($target))) 'bad signature changed archive'
    Assert ((Get-Content $State -Raw | ConvertFrom-Json).bundle -eq 7) 'bad signature advanced bundle'
    $script:pending.sig = $sig
    Handle-Unchanged $cfg $sims $st 'same' 0
    Assert ($script:requests.Count -eq 3) 'failed update did not retry on unchanged content'
    Assert ((Get-Content $State -Raw | ConvertFrom-Json).bundle -eq 8) 'verified update was not recorded'
    $zip = [IO.Compression.ZipFile]::OpenRead($target)
    try {
        foreach ($pair in @(@('config.json','original config.json'), @('twentygen_sync.pyc','new sync'), @('twentygen_net.pyc','new net'))) {
            $reader = New-Object IO.StreamReader($zip.GetEntry($pair[0]).Open()); $value = $reader.ReadToEnd(); $reader.Dispose()
            Assert ($value -eq $pair[1]) "unexpected archive entry $($pair[0])"
        }
    } finally { $zip.Dispose() }
    $after = [Convert]::ToBase64String([IO.File]::ReadAllBytes($target))
    $st = Get-Content $State -Raw | ConvertFrom-Json
    Handle-Unchanged $cfg $sims $st 'same' 0
    Assert ($after -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes($target))) 'already installed bundle swapped archive'
    Assert ($script:requests.Count -eq 4) 'already installed check made extra requests'
    Write-Host 'helper recovery tests passed'
} finally { Remove-Item -LiteralPath $Home2 -Recurse -Force -ErrorAction SilentlyContinue }
