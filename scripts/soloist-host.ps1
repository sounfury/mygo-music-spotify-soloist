param([ValidateSet('config','pkce','setup')][string]$Action = 'config')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$secretRoot = Join-Path $env:LOCALAPPDATA 'MyGoSoloist'
$keyFile = Join-Path $secretRoot 'soloist-key.xml'
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
    if ($Action -eq 'pkce') {
        $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
        $bytes = New-Object byte[] 48
        $rng.GetBytes($bytes)
        $verifier = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
        $rng.GetBytes($bytes)
        $state = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
        $sha = [Security.Cryptography.SHA256]::Create()
        $challenge = [Convert]::ToBase64String($sha.ComputeHash([Text.Encoding]::ASCII.GetBytes($verifier))).TrimEnd('=').Replace('+','-').Replace('/','_')
        $rng.Dispose(); $sha.Dispose()
        @{verifier=$verifier;challenge=$challenge;state=$state} | ConvertTo-Json -Compress
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
    [Console]::Error.WriteLine('Soloist helper failed. Check the local key configuration or run setup again.')
    exit 1
}
