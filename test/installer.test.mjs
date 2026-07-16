import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("PowerShell installer updates atomically and uninstall removes only theme files", {
  skip: process.platform !== "win32",
}, () => {
  const appData = mkdtempSync(join(tmpdir(), "codex-shinobu-theme-test-"));
  const codexPlusPlus = join(appData, "codex-plusplus");
  const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8"));
  assert.match(readFileSync(join(projectRoot, "install.ps1"), "utf8"), /ChatGPT\.exe/);
  const destination = join(codexPlusPlus, "tweaks", manifest.id);
  const backups = join(codexPlusPlus, "theme-backups");
  const fakeApp = join(appData, "patched-app");
  const desktop = join(appData, "Desktop");
  const shortcutPath = join(desktop, "Codex++.lnk");
  const launcher = join(fakeApp, "Codex.exe");
  const actualApp = join(fakeApp, "ChatGPT.exe");
  mkdirSync(codexPlusPlus, { recursive: true });
  mkdirSync(fakeApp, { recursive: true });
  mkdirSync(desktop, { recursive: true });
  writeFileSync(launcher, "");
  writeFileSync(actualApp, "");

  const runPowerShell = (args) => spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, APPDATA: appData, USERPROFILE: appData },
    },
  );

  try {
    const escapePowerShell = (value) => value.replaceAll("'", "''");
    const createShortcut = runPowerShell([
      "-Command",
      `$shell=New-Object -ComObject WScript.Shell; $shortcut=$shell.CreateShortcut('${escapePowerShell(shortcutPath)}'); $shortcut.TargetPath='${escapePowerShell(launcher)}'; $shortcut.WorkingDirectory='${escapePowerShell(fakeApp)}'; $shortcut.Save()`,
    ]);
    assert.equal(createShortcut.status, 0, createShortcut.stderr || createShortcut.stdout);

    const first = runPowerShell(["-File", join(projectRoot, "install.ps1")]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.ok(existsSync(join(destination, manifest.main)));
    assert.ok(existsSync(join(destination, "assets", "shinobu-icon.svg")));
    const shortcutTarget = runPowerShell([
      "-Command",
      `$shell=New-Object -ComObject WScript.Shell; $shell.CreateShortcut('${escapePowerShell(shortcutPath)}').TargetPath`,
    ]);
    assert.equal(shortcutTarget.status, 0, shortcutTarget.stderr || shortcutTarget.stdout);
    assert.equal(shortcutTarget.stdout.trim(), actualApp);

    const second = runPowerShell(["-File", join(projectRoot, "install.ps1")]);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(readdirSync(backups).length, 1);

    const uninstallCommand = `& '${join(projectRoot, "uninstall.ps1").replaceAll("'", "''")}' -Confirm:$false`;
    const removed = runPowerShell(["-Command", uninstallCommand]);
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    assert.equal(existsSync(destination), false);
  } finally {
    rmSync(appData, { recursive: true, force: true });
  }
});

test("release package contains the theme, local-image docs, optimizer, and checksum", {
  skip: process.platform !== "win32",
}, () => {
  const outputRoot = mkdtempSync(join(tmpdir(), "codex-shinobu-package-test-"));
  const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8"));
  const folderName = `codex-shinobu-theme-v${manifest.version}`;
  const staging = join(outputRoot, folderName);
  const zip = join(outputRoot, `${folderName}-windows.zip`);
  const checksum = `${zip}.sha256`;
  try {
    const packed = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", join(projectRoot, "scripts", "package.ps1"),
        "-OutputRoot", outputRoot,
      ],
      { cwd: projectRoot, encoding: "utf8", env: process.env },
    );
    assert.equal(packed.status, 0, packed.stderr || packed.stdout);

    for (const relative of [
      manifest.main,
      "manifest.json",
      "install.cmd",
      "install.ps1",
      "Optimize-Codex.cmd",
      join("assets", "shinobu-icon.svg"),
      join("assets", "shinobu-hero-safe-landscape.webp"),
      join("docs", "AUTO-PALETTE.md"),
      join("docs", "VISUAL-QA.md"),
      join("docs", "CODEX-WINDOWS-OPTIMIZER.md"),
      join("tools", "Optimize-Codex.ps1"),
    ]) {
      assert.ok(existsSync(join(staging, relative)), `release is missing ${relative}`);
    }
    assert.ok(existsSync(zip));
    assert.ok(existsSync(checksum));
    assert.match(
      readFileSync(checksum, "ascii").trim(),
      new RegExp(`^[0-9a-f]{64}  ${folderName}-windows\\.zip$`),
    );
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});
