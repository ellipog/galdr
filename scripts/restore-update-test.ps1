# Restores tauri.conf.json after local update testing.
# Run this after test-update-local.ps1 to clean up.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "Restoring tauri.conf.json to its committed state..." -ForegroundColor Yellow
Write-Host "Any unstaged changes to tauri.conf.json will be LOST." -ForegroundColor Yellow

Push-Location $root
git checkout -- "src-tauri/tauri.conf.json"
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Restored tauri.conf.json" -ForegroundColor Green
} else {
    Write-Host "! Git checkout failed. Revert manually:" -ForegroundColor Red
    Write-Host "  - version → read from tauri.conf.json"
    Write-Host '  - endpoint → "https://github.com/ellipog/galdr/releases/latest/download/update.json"'
}
Pop-Location

# Also restore Cargo.toml if it was changed
Push-Location $root
git checkout -- "src-tauri/Cargo.toml" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "✓ Restored Cargo.toml" -ForegroundColor Green
}
Pop-Location

Write-Host ""
Write-Host "Cleanup (optional):" -ForegroundColor Cyan
Write-Host "  Remove-Item '$root\update.test.json'   (delete test config)"
Write-Host "  (Ctrl+C in the HTTP server terminal to stop it)"
