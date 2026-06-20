# Prepares local update artifacts for end-to-end testing using a local HTTP server.
# Run this FIRST, then follow the printed instructions.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# ── Read version ────────────────────────────────────────────────────
$confPath = Join-Path $root "src-tauri\tauri.conf.json"
$conf = Get-Content $confPath -Raw
if ($conf -match '"version"\s*:\s*"([^"]+)"') {
    $version = $Matches[1]
} else {
    Write-Host "! Could not read version from tauri.conf.json" -ForegroundColor Red
    exit 1
}

# Test update version = bump minor (e.g., 0.2.0 → 0.3.0)
$segments = $version.Split(".")
$testVersion = "$($segments[0]).$([int]$segments[1] + 1).0"

Write-Host "Current version: $version" -ForegroundColor Cyan
Write-Host "Test update version: $testVersion" -ForegroundColor Cyan

$nsisZip = "$root\src-tauri\target\release\bundle\nsis\galdr_${version}_x64-setup.exe.zip"
$nsisExe = "$root\src-tauri\target\release\bundle\nsis\galdr_${version}_x64-setup.exe"
$pubDate = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")

# ── Load .env for key path and password ──────────────────────────────
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
        if ($_ -match "^\s*UPDATER_PRIVATE_KEY_PASSWORD\s*=\s*(.+)$") {
            $env:UPDATER_PRIVATE_KEY_PASSWORD = $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    Write-Host "Using private key: $keyPath" -ForegroundColor DarkGray
} else {
    Write-Host ".env not found — using default key path: $keyPath" -ForegroundColor Yellow
}

# ── Build (if no existing archive) ──────────────────────────────────
if (-not (Test-Path $nsisZip)) {
    Write-Host "`n[1/3] No existing archive — building..." -ForegroundColor Cyan
    Push-Location $root
    bun tauri build
    if (-not $?) { Pop-Location; exit 1 }
    Pop-Location
} else {
    Write-Host "`n[1/3] Using existing archive" -ForegroundColor Cyan
}

# Create .exe.zip if only .exe exists
if (-not (Test-Path $nsisZip) -and (Test-Path $nsisExe)) {
    Write-Host "Creating .exe.zip from existing installer..." -ForegroundColor Yellow
    python -c "import zipfile,os,sys; zipfile.ZipFile(sys.argv[1],'w',zipfile.ZIP_DEFLATED).write(sys.argv[2],os.path.basename(sys.argv[2]))" "$nsisZip" "$nsisExe"
}

if (-not (Test-Path $nsisZip)) {
    Write-Host "! No archive found at $nsisZip" -ForegroundColor Red
    Write-Host "  Build the app first: bun tauri build"
    exit 1
}

# ── Sign ────────────────────────────────────────────────────────────
Write-Host "[2/3] Signing archive..." -ForegroundColor Cyan
$sigOutput = & bun x tauri signer sign `
    --private-key-path "$keyPath" `
    "$nsisZip" 2>&1 | Out-String

if ($LASTEXITCODE -ne 0) {
    $sigOutput = & bun run tauri signer sign `
        --private-key-path "$keyPath" `
        "$nsisZip" 2>&1 | Out-String
}

$signature = ($sigOutput -split "`n" | Where-Object { $_ -match "^(dW50cn|RW)" } | Select-Object -First 1).Trim()
if (-not $signature) {
    Write-Host "! Failed to extract signature" -ForegroundColor Red
    Write-Host $sigOutput
    exit 1
}
Write-Host "  Signature captured" -ForegroundColor Green

# Verify signature was for the correct file
try {
    $sigBytes = [System.Convert]::FromBase64String($signature)
    $sigText = [System.Text.Encoding]::UTF8.GetString($sigBytes)
    if ($sigText -match "file:(.+)$") {
        $signedFile = $Matches[1].Trim()
        $expectedFile = "galdr_${version}_x64-setup.exe.zip"
        if ($signedFile -ne $expectedFile) {
            Write-Host "! Signature was for wrong file: '$signedFile'" -ForegroundColor Red
            Write-Host "  Expected: '$expectedFile'" -ForegroundColor Red
            Write-Host "  The version in tauri.conf.json may have changed after signing." -ForegroundColor Red
            exit 1
        }
        Write-Host "  Signature verified for: $signedFile" -ForegroundColor Green
    } else {
        Write-Host "! Could not read filename from signature trusted comment" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "! Failed to decode signature: $_" -ForegroundColor Red
    exit 1
}

# ── Generate test update.json with HTTP URL ─────────────────────────
Write-Host "[3/3] Generating test update.json..." -ForegroundColor Cyan

# URL path relative to repo root (where the HTTP server runs)
$zipRelPath = "src-tauri/target/release/bundle/nsis/galdr_${version}_x64-setup.exe.zip"
$zipUrl = "http://127.0.0.1:8080/$zipRelPath"

$testJson = @"
{
  "version": "$testVersion",
  "notes": "Local test update",
  "pub_date": "$pubDate",
  "platforms": {
    "windows-x86_64": {
      "signature": "$signature",
      "url": "$zipUrl"
    }
  }
}
"@
Set-Content -Path "$root\update.test.json" -Value $testJson -Encoding UTF8

Write-Host "`n================================================================" -ForegroundColor Green
Write-Host "  TEST UPDATE ARTIFACTS READY" -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Archive:         $nsisZip"
Write-Host "Test config:     $root\update.test.json"
Write-Host ""
Write-Host "STEP-BY-STEP INSTRUCTIONS:" -ForegroundColor Yellow
Write-Host ""
Write-Host "  STEP 1 — Start a local HTTP server (in a NEW terminal):"
Write-Host "    cd $root"
Write-Host "    python -m http.server 8080"
Write-Host ""
Write-Host "  STEP 2 — Edit src-tauri\tauri.conf.json, change two things:"
Write-Host ""
Write-Host "    a) Updater endpoint → local (line 71):"
Write-Host '       "endpoints": ["http://127.0.0.1:8080/update.test.json"]'
Write-Host ""
Write-Host "    b) Version → lower than $testVersion (line 4):"
Write-Host '       "version": "0.0.1"'
Write-Host ""
Write-Host "  STEP 3 — In another terminal, run the app:"
Write-Host "    cd $root"
Write-Host "    bun tauri dev"
Write-Host ""
Write-Host "  STEP 4 — The app should show the update banner for v$testVersion."
Write-Host "    Click 'upgrade' — it will download the archive from localhost."
Write-Host "    After download, you'll see the error message (if any) in the UI."
Write-Host ""
Write-Host "  STEP 5 — When done, REVERT changes in tauri.conf.json:"
Write-Host '       "version": "'$version'"'
Write-Host '       "endpoints": ["https://github.com/ellipog/galdr/releases/latest/download/update.json"]'
Write-Host ""
Write-Host "    Then kill the HTTP server (Ctrl+C in that terminal)."
Write-Host ""
Write-Host "  TIP: Delete update.test.json when you're done:"
Write-Host "    Remove-Item update.test.json"
Write-Host ""
Write-Host "  TIP: To also test the install step, actually install a low-version build"
Write-Host "  first (build with '0.0.1', run the installer), then point it at the HTTP server."
Write-Host ""
Write-Host "  DEBUG: Verify the server is working:"
Write-Host "    curl http://127.0.0.1:8080/update.test.json"
Write-Host "    curl http://127.0.0.1:8080/$zipRelPath"
Write-Host "================================================================" -ForegroundColor Green
