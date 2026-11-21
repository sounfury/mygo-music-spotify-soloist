param(
    [ValidateSet('config','setup','stage','install')][string]$Action = 'config',
    [string]$PluginDir = '',
    [switch]$ForceDownload
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$secretRoot = Join-Path $env:LOCALAPPDATA 'MyGoSoloist'
$keyFile = Join-Path $secretRoot 'soloist-key.xml'
$stagingRoot = Join-Path $secretRoot 'staging'
$stagedExe = Join-Path $stagingRoot 'soloist.exe'
$stagedMeta = Join-Path $stagingRoot 'meta.json'
$downloadUrl = 'https://soloist-builds.spotifycdn.com/soloist_release_windows_x86_64.zip'

function Parse-SoloistVersion([string]$exePath) {
    $raw = (& $exePath --version 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Downloaded soloist.exe failed version verification.' }
    if ($raw -notmatch '^soloist\s+([0-9][^\s]*)\s+build\s+(\d+)\b.*windows/x86_64') {
        throw 'Downloaded soloist.exe returned an unexpected version signature.'
    }
    return @{
        version = $Matches[1]
        buildTimestamp = [int64]$Matches[2]
        versionText = ($raw -split "`r?`n")[0].Trim()
    }
}

function Normalize-Etag([string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return '' }
    return ($value.Trim() -replace '^W/', '' -replace '^"+|"+$', '')
}

function Invoke-StageSoloist() {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
    $workDir = Join-Path $stagingRoot ('dl-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null
    $zipPath = Join-Path $workDir 'soloist.zip'
    $candidateExe = Join-Path $workDir 'soloist.exe'
    try {
        $req = [Net.HttpWebRequest]::Create($downloadUrl)
        $req.Method = 'GET'
        $req.Timeout = 30000
        $req.ReadWriteTimeout = 60000
        $req.AutomaticDecompression = [Net.DecompressionMethods]::None
        $resp = $req.GetResponse()
        try {
            $etag = Normalize-Etag $resp.Headers['ETag']
            $lastModified = [string]$resp.Headers['Last-Modified']
            $expectedLength = $resp.ContentLength
            $stream = $resp.GetResponseStream()
            try {
                $fs = [IO.File]::Create($zipPath)
                try { $stream.CopyTo($fs) }
                finally { $fs.Dispose() }
            } finally { $stream.Dispose() }
        } finally { $resp.Dispose() }

        $actualLength = (Get-Item -LiteralPath $zipPath).Length
        if ($actualLength -le 0 -or ($expectedLength -gt 0 -and $actualLength -ne $expectedLength)) {
            throw 'Downloaded archive size mismatch.'
        }
        if ($etag -match '^[0-9a-fA-F]{32}$') {
            $hash = (Get-FileHash -Algorithm MD5 -LiteralPath $zipPath).Hash.ToLowerInvariant()
            if ($hash -ne $etag.ToLowerInvariant()) {
                throw 'Downloaded archive checksum mismatch.'
            }
        }

        $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
        try {
            $entry = $archive.Entries | Where-Object { $_.Name -ieq 'soloist.exe' } | Select-Object -First 1
            if ($null -eq $entry) { throw 'Archive did not contain soloist.exe.' }
            $inStream = $entry.Open()
            try {
                $outStream = [IO.File]::Create($candidateExe)
                try { $inStream.CopyTo($outStream) }
                finally { $outStream.Dispose() }
            } finally { $inStream.Dispose() }
        } finally { $archive.Dispose() }

        $info = Parse-SoloistVersion $candidateExe
        $meta = @{
            version = $info.version
            buildTimestamp = $info.buildTimestamp
            versionText = $info.versionText
            etag = $etag
            lastModified = $lastModified
            stagedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        }
        Move-Item -LiteralPath $candidateExe -Destination $stagedExe -Force
        ($meta | ConvertTo-Json -Compress) | Set-Content -LiteralPath $stagedMeta -Encoding UTF8
        return $meta
    } finally {
        if (Test-Path -LiteralPath $workDir) {
            Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Stop-TargetSoloist([string]$targetExe) {
    $procs = Get-CimInstance Win32_Process -Filter "Name='soloist.exe'" -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        if ($proc.ExecutablePath -and ($proc.ExecutablePath -ieq $targetExe)) {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    $deadline = [DateTime]::UtcNow.AddSeconds(3)
    while ([DateTime]::UtcNow -lt $deadline) {
        $still = Get-CimInstance Win32_Process -Filter "Name='soloist.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $targetExe) }
        if (!$still) { break }
        Start-Sleep -Milliseconds 100
    }
}

function Invoke-InstallSoloist([string]$pluginDir, [bool]$forceDownload) {
    if ([string]::IsNullOrWhiteSpace($pluginDir)) { throw 'Missing PluginDir parameter.' }
    $pluginFull = (Resolve-Path -LiteralPath $pluginDir).Path
    if (!(Test-Path -LiteralPath (Join-Path $pluginFull 'plugin.json'))) {
        throw 'Target directory is not a valid MyGo plugin folder.'
    }
    $meta = $null
    if (!$forceDownload -and (Test-Path -LiteralPath $stagedExe)) {
        try {
            $verified = Parse-SoloistVersion $stagedExe
            $nowSec = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
            if (($nowSec - $verified.buildTimestamp) -lt (89 * 86400)) {
                $saved = $null
                if (Test-Path -LiteralPath $stagedMeta) {
                    try { $saved = Get-Content -Raw -LiteralPath $stagedMeta | ConvertFrom-Json } catch {}
                }
                $meta = @{
                    version = $verified.version
                    buildTimestamp = $verified.buildTimestamp
                    versionText = $verified.versionText
                    etag = if ($saved -and $saved.etag) { [string]$saved.etag } else { '' }
                    lastModified = if ($saved -and $saved.lastModified) { [string]$saved.lastModified } else { '' }
                }
            }
        } catch {
            $meta = $null
        }
    }
    if ($null -eq $meta) {
        $meta = Invoke-StageSoloist
    }

    $binDir = Join-Path $pluginFull 'bin'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null
    $targetExe = Join-Path $binDir 'soloist.exe'
    $incomingExe = Join-Path $binDir ('soloist.new.' + [Guid]::NewGuid().ToString('N') + '.exe')
    $backupExe = Join-Path $binDir 'soloist.exe.bak'

    Copy-Item -LiteralPath $stagedExe -Destination $incomingExe -Force
    try {
        Stop-TargetSoloist $targetExe
        $backedUp = $false
        if (Test-Path -LiteralPath $targetExe) {
            if (Test-Path -LiteralPath $backupExe) { Remove-Item -LiteralPath $backupExe -Force -ErrorAction SilentlyContinue }
            for ($i = 0; $i -lt 10; $i++) {
                try {
                    Move-Item -LiteralPath $targetExe -Destination $backupExe -Force
                    $backedUp = $true
                    break
                } catch {
                    if ($i -eq 9) { throw }
                    Start-Sleep -Milliseconds 150
                }
            }
        }
        try {
            Move-Item -LiteralPath $incomingExe -Destination $targetExe -Force
        } catch {
            if ($backedUp -and (Test-Path -LiteralPath $backupExe) -and !(Test-Path -LiteralPath $targetExe)) {
                Move-Item -LiteralPath $backupExe -Destination $targetExe -Force -ErrorAction SilentlyContinue
            }
            throw
        }
        if ($backedUp -and (Test-Path -LiteralPath $backupExe)) {
            Remove-Item -LiteralPath $backupExe -Force -ErrorAction SilentlyContinue
        }
        Remove-Item -LiteralPath $stagedExe -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $stagedMeta -Force -ErrorAction SilentlyContinue
    } finally {
        if (Test-Path -LiteralPath $incomingExe) {
            Remove-Item -LiteralPath $incomingExe -Force -ErrorAction SilentlyContinue
        }
    }

    return @{
        installed = $true
        version = $meta.version
        buildTimestamp = $meta.buildTimestamp
        versionText = $meta.versionText
        etag = $meta.etag
        lastModified = $meta.lastModified
    }
}

try {
    if ($Action -eq 'setup') {
        $secret = Read-Host 'Paste your personal Soloist API key (hidden input)' -AsSecureString
        if (!$secret.Length) { throw 'No API key entered.' }
        New-Item -ItemType Directory -Path $secretRoot -Force | Out-Null
        $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $keyFile -Encoding UTF8
        $secret.Dispose()
        Write-Host 'Saved for this Windows user. Restart the plugin, then play a song.'
        exit 0
    }
    if ($Action -eq 'stage') {
        $meta = Invoke-StageSoloist
        (@{
            staged = $true
            version = $meta.version
            buildTimestamp = $meta.buildTimestamp
            versionText = $meta.versionText
            etag = $meta.etag
            lastModified = $meta.lastModified
        } | ConvertTo-Json -Compress)
        exit 0
    }
    if ($Action -eq 'install') {
        $result = Invoke-InstallSoloist $PluginDir ([bool]$ForceDownload)
        ($result | ConvertTo-Json -Compress)
        exit 0
    }
    if (!(Test-Path -LiteralPath $keyFile)) { throw 'Run scripts/soloist-host.ps1 -Action setup to save your Soloist API key first.' }
    $secret = (Get-Content -Raw -LiteralPath $keyFile).Trim() | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try { $key = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr); $secret.Dispose() }
    # stdout is consumed only by the plugin. Never log this response.
    @{key=$key;dataDir=(Join-Path $env:LOCALAPPDATA 'soloist\data');cacheDir=(Join-Path $env:LOCALAPPDATA 'soloist\cache')} | ConvertTo-Json -Compress
    $key=$null
} catch {
    if ($Action -eq 'stage' -or $Action -eq 'install') {
        [Console]::Error.WriteLine($_.Exception.Message)
    } else {
        [Console]::Error.WriteLine('Soloist helper failed. Check the local key configuration or run setup again.')
    }
    exit 1
}
