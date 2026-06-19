# Builds the Tauri app and generates the updater signature.
# Run after `build-ffmpeg.ps1` (downloads FFmpeg binaries).

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

# ── Load .env for key path ──────────────────────────────────────────
$envFile = Join-Path $root "src-tauri\.env"
$keyPath = "$root\src-tauri\updater.key"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*UPDATER_PRIVATE_KEY_PATH\s*=\s*(.+)$") {
            $keyPath = $Matches[1].Trim().Trim('"').Trim("'")
            if (-not [System.IO.Path]::IsPathRooted($keyPath)) {
                $keyPath = Join-Path $root $keyPath
            }
        }
    }
    Write-Host "Using private key: $keyPath" -ForegroundColor DarkGray
} else {
    Write-Host ".env not found — using default key path: $keyPath" -ForegroundColor Yellow
}
if (-not (Test-Path $keyPath)) {
    Write-Host "! Private key not found at $keyPath" -ForegroundColor Red
    exit 1
}

# ── Read version from tauri.conf.json ──────────────────────────────
$confPath = Join-Path $root "src-tauri\tauri.conf.json"
$conf = Get-Content $confPath -Raw
if ($conf -match '"version"\s*:\s*"([^"]+)"') {
    $version = $Matches[1]
} else {
    Write-Host "! Could not read version from tauri.conf.json" -ForegroundColor Red
    exit 1
}
Write-Host "Version: $version" -ForegroundColor Cyan

$nsisExe = "$root\src-tauri\target\release\bundle\nsis\galdr_${version}_x64-setup.exe"
$nsisZip = "$root\src-tauri\target\release\bundle\nsis\galdr_${version}_x64-setup.exe.zip"
$pubDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
$url = "https://github.com/ellipog/galdr/releases/download/v$version/galdr_${version}_x64-setup.exe.zip"

# ── 0. Generate installer skin assets ──────────────────────────
Write-Host "`n[0/4] Generating nsNiuniuSkin installer assets..." -ForegroundColor Cyan
python "$root\src-tauri\windows\nsniuniuskin\generate-assets.py"
python "$root\src-tauri\windows\nsniuniuskin\generate-skin-zip.py"

# ── 1. Build ────────────────────────────────────────────────────────
Write-Host "`n[1/4] Building Tauri app..." -ForegroundColor Cyan
Write-Host "Installing dependencies..." -ForegroundColor DarkGray
bun install
if (-not $?) { exit 1 }
bun tauri build
if (-not $?) { exit 1 }

# ── 2. Create .exe.zip if missing ──────────────────────────────────
Write-Host "`n[2/4] Preparing archive..." -ForegroundColor Cyan
if (-not (Test-Path $nsisZip)) {
    if (-not (Test-Path $nsisExe)) {
        Write-Host "! No NSIS installer found at $nsisExe" -ForegroundColor Red
        exit 1
    }
    Write-Host "Creating .exe.zip..."
    Compress-Archive -Path $nsisExe -DestinationPath $nsisZip -Force
}
$zipSize = (Get-Item $nsisZip).Length / 1MB
Write-Host "Archive: $nsisZip ($([math]::Round($zipSize, 1)) MB)"

# ── 3. Sign ─────────────────────────────────────────────────────────
Write-Host "`n[3/4] Signing archive..." -ForegroundColor Cyan
$sigOutput = & bun x tauri signer sign `
    --private-key-path "$keyPath" `
    "$nsisZip" 2>&1 | Out-String

if ($LASTEXITCODE -ne 0) {
    $sigOutput = & bun run tauri signer sign `
        --private-key-path "$keyPath" `
        "$nsisZip" 2>&1 | Out-String
}

# Extract just the signature line (starts with dW50cn... or RW...)
$signature = ($sigOutput -split "`n" | Where-Object { $_ -match "^(dW50cn|RW)" } | Select-Object -First 1).Trim()

if (-not $signature) {
    Write-Host "! Failed to extract signature from output:" -ForegroundColor Red
    Write-Host $sigOutput
    exit 1
}
Write-Host "Signature captured" -ForegroundColor Green

# ── 4. Generate update.json ────────────────────────────────────────
Write-Host "`n[4/4] Generating update.json..." -ForegroundColor Cyan
$updateJson = @"
{
  "version": "$version",
  "notes": "See https://github.com/ellipog/galdr/releases/tag/v$version",
  "pub_date": "$pubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$signature",
      "url": "$url"
    }
  }
}
"@
Set-Content -Path "$root\update.json" -Value $updateJson -Encoding UTF8

# ── Verify ──────────────────────────────────────────────────────────
Write-Host "`n--- update.json ---" -ForegroundColor DarkGray
Get-Content "$root\update.json" | Write-Host
Write-Host "---" -ForegroundColor DarkGray

# Verify archive is a valid zip
Write-Host "`nVerifying archive..." -ForegroundColor Cyan
try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($nsisZip)
    $entryCount = $zip.Entries.Count
    $zip.Dispose()
    Write-Host "  Archive is valid zip ($entryCount entries)" -ForegroundColor Green
} catch {
    Write-Host "  ! Archive is not a valid zip: $_" -ForegroundColor Red
    exit 1
}

# Verify signature format
if ($signature -match "^dW50cn") {
    Write-Host "  Signature format: minisign (base64)" -ForegroundColor Green
} elseif ($signature -match "^RW") {
    Write-Host "  Signature format: minisign (raw)" -ForegroundColor Green
} else {
    Write-Host "  ! Unexpected signature format" -ForegroundColor Red
    exit 1
}

# Verify update.json is valid JSON
try {
    $null = Get-Content "$root\update.json" -Raw | ConvertFrom-Json
    Write-Host "  update.json is valid JSON" -ForegroundColor Green
} catch {
    Write-Host "  ! update.json is not valid JSON: $_" -ForegroundColor Red
    exit 1
}

Write-Host "`nDone!" -ForegroundColor Green
Write-Host "Artifacts:" -ForegroundColor Cyan
Get-ChildItem -Path "$root\src-tauri\target\release\bundle\nsis\" -Name

Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  1. Upload galdr_${version}_x64-setup.exe.zip to GitHub release v$version"
Write-Host "  2. Upload update.json to the same release"
Write-Host "  3. Tag the release as 'latest'"
