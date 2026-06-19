# ᚲ galdr

> A rune-encrusted desktop GUI around FFmpeg — convert video, audio, and image files with the elegance of ancient incantations.

galdr (Old Norse for "magical incantation") frames media conversion as spellcasting: raw media in, enchanted media out. No command-line incantations to memorize.

---

## Features

- **Single-file conversion** — drag-and-drop, pick a format, tweak parameters, watch the FFmpeg command build in real time
- **Batch conversion** — point at a folder, auto-scan for media, process with skip/resume
- **Compression** — quality slider with live size estimation, before/after preview
- **Rune Tags** — save/load conversion presets as named "runes" (Fehu, Kaunan, Tiwaz, Dagaz)
- **Command Alchemy** — live FFmpeg command preview with syntax highlighting and hover tooltips
- **Side-by-side preview** — synchronized video wipe, waveform overlay, pixel-diff comparison
- **Custom titlebar** — undecorated window with ScrambleText logo and runic window controls
- **Page transitions** — 5 animated styles (rune dissolve, terminal scroll, runic portal, ink ripple, angular carve)
- **Discord Rich Presence** — shows what you're converting on your profile
- **In-app updater** — checks GitHub releases, downloads & installs with verified signatures
- **Bundled FFmpeg** — zero configuration, portable static binaries included

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | [Tauri 2](https://v2.tauri.app/) (Rust) |
| Frontend | [React 19](https://react.dev/) + TypeScript |
| Build tool | [Vite 7](https://vite.dev/) |
| State | [Zustand 5](https://zustand.docs.pmnd.rs/) |
| Animation | [Framer Motion 12](https://motion.dev/) |
| Package manager | [Bun](https://bun.sh/) |
| Media engine | [FFmpeg](https://ffmpeg.org/) (bundled static build) |

---

## Getting Started

### Prerequisites

- [Rust toolchain](https://rustup.rs/) (latest stable)
- [Bun](https://bun.sh/) (≥ 1.x)
- [Tauri system dependencies](https://v2.tauri.app/start/prerequisites/)

### Development

```bash
bun install
bun tauri dev
```

This starts a Vite dev server on port 1420 and opens the Tauri window.

### Building

```bash
# Windows (PowerShell)
.\build-ffmpeg.ps1
.\build-and-deploy.ps1

# Cross-platform (Git Bash / Linux / macOS)
./deploy.sh [new_version]
```

`deploy.sh` handles: version bumping → platform-specific FFmpeg download → `bun tauri build` → artifact packaging (.exe.zip, .tar.gz, .dmg.gz) → signing → `update.json` generation with multi-platform merge support.

---

## Updating

Step-by-step guide to build and release a new version of galdr.

### Windows (PowerShell)

```powershell
.\build-ffmpeg.ps1
.\build-and-deploy.ps1
```

### Cross-platform (Git Bash / Linux / macOS)

```bash
./deploy.sh [new_version]
```

### Steps

1. **Bump the version** in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` (or pass the version to `deploy.sh` — it handles this automatically)
2. **Download FFmpeg binaries** — `.\build-ffmpeg.ps1` fetches the static build for your platform
3. **Build the Tauri app** — `.\build-and-deploy.ps1` runs `bun tauri build` and creates the installer
4. **Sign the archive** — the script prompts for a signature via `bun tauri signer sign --private-key-path src-tauri/updater.key <archive>`
5. **Upload to GitHub** — create a release tagged `v{version}` and upload:
   - The installer archive (`.exe.zip` for Windows, `.dmg` for macOS, `.AppImage` or `.deb` for Linux)
   - The generated `update.json`
6. **Publish the release** — the in-app updater checks `releases/latest/download/update.json` automatically

### Multi-platform releases

Build on each platform separately using `deploy.sh [version]`. Each run merges its platform entry into `update.json` automatically.

---

## Project Structure

```
src/                    # Frontend (React + TypeScript)
├── components/         # UI components (titlebar, dropdown, previews, etc.)
├── pages/              # Page components (convert, batch, compress, runes, settings)
├── store/              # Zustand state management
├── transitions/        # Page transition animations
├── types.ts            # TypeScript type definitions
src-tauri/              # Backend (Rust)
├── src/
│   ├── lib.rs          # Tauri app setup, plugin registration
│   ├── commands.rs     # IPC command handlers
│   ├── builder.rs      # FFmpeg command construction
│   ├── reziser.rs      # Compression size estimation
│   └── probe.rs        # Media probing via ffprobe
├── binaries/           # Downloaded FFmpeg/FFprobe static binaries
├── tauri.conf.json     # Tauri configuration
└── Cargo.toml          # Rust dependencies
```

---

## Platforms

| Platform | Installer | Updater |
|----------|-----------|---------|
| Windows x86_64 | NSIS (.exe) | ✅ `.exe.zip` |
| macOS (Intel / Apple Silicon) | DMG | ✅ |
| Linux (x86_64 / aarch64) | AppImage / .deb | ✅ |

Mobile (Android/iOS) infrastructure exists but is not yet functional.

---

## Licensing

This project incorporates static FFmpeg binaries distributed under their respective licenses. The application source code is available for reference.