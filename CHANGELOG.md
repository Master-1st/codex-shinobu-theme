# Changelog

## 1.1.0 — 2026-07-16

- Replaces the portrait background with a 16:9 safe-area illustration and moves the artwork to one continuous root-canvas layer.
- Keeps conversation, approvals, long output, and composers inside a 32vw reading rail from 800 px upward; smaller windows use a softened background.
- Adds on-device automatic palette extraction for imported PNG, JPG, and WebP artwork, including readable text contrast, a settings preview, disable/reset behavior, and legacy-image migration.
- Adds repeatable visual QA for normal, split, long-output, approval, menu, dialog, settings, artwork-off, and responsive states.
- Validates all theme selectors against Codex Desktop `26.707.12708.0` and leaves the pet/avatar overlay renderer untouched.
- Adds a standalone Windows optimizer that safely rotates oversized diagnostic logs, clears disposable Chromium/GPU caches, and preserves sessions and sign-in data.
- Expands automated coverage to 14 tests, including palette failure fallback, release-package completeness, and Windows installer/optimizer safety.

## 1.0.0 — 2026-07-16

- First Windows release.
- Uses a generated 3:4 Shinobu portrait background derived from the user-selected reference image.
- Keeps the real Codex conversation and composer in a separate left work area on wide windows.
- Provides lemon-yellow, mint-green, cream, and blush UI colors.
- Supports local PNG, JPG, and WebP imports, image positioning, cover/contain modes, and reset.
- Includes safe install, update backup, uninstall, automated tests, and a SHA-256 release checksum.
