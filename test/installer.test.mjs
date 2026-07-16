import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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
  const destination = join(codexPlusPlus, "tweaks", manifest.id);
  const backups = join(codexPlusPlus, "theme-backups");
  mkdirSync(codexPlusPlus, { recursive: true });

  const runPowerShell = (args) => spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, APPDATA: appData },
    },
  );

  try {
    const first = runPowerShell(["-File", join(projectRoot, "install.ps1")]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.ok(existsSync(join(destination, manifest.main)));
    assert.ok(existsSync(join(destination, "assets", "shinobu-icon.svg")));

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

