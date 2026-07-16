# Changelog

## Unreleased

- Changes the wide layout from a separate right-side gallery to Miku-style full-canvas artwork with readable translucent conversation surfaces.
- Leaves the Codex pet/avatar overlay renderer untouched so auxiliary windows keep their transparent background.
- Adds a standalone Windows optimizer that analyzes Codex resource usage, safely rotates oversized diagnostic logs, clears disposable Chromium/GPU caches, and preserves sessions and sign-in data.
- Adds automated coverage for the optimizer's read-only analysis mode.

## 1.0.0 — 2026-07-16

- First Windows release.
- Uses a generated 3:4 Shinobu portrait background derived from the user-selected reference image.
- Keeps the real Codex conversation and composer in a separate left work area on wide windows.
- Provides lemon-yellow, mint-green, cream, and blush UI colors.
- Supports local PNG, JPG, and WebP imports, image positioning, cover/contain modes, and reset.
- Includes safe install, update backup, uninstall, automated tests, and a SHA-256 release checksum.
