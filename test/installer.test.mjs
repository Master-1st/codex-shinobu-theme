import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  const localAppData = join(appData, "Local");
  const desktop = join(appData, "Desktop");
  const shortcutPath = join(desktop, "Codex++.lnk");
  const startMenu = join(appData, "Microsoft", "Windows", "Start Menu", "Programs");
  const startMenuShortcutPath = join(startMenu, "Codex++.lnk");
  const launcher = join(fakeApp, "Codex.exe");
  const actualApp = join(fakeApp, "ChatGPT.exe");
  const currentMirror = join(localAppData, "codex-plusplus", "store-apps", "OpenAI.Codex_99.1.2.3_x64__test", "app");
  const currentMirrorApp = join(currentMirror, "ChatGPT.exe");
  const staleApp = join(appData, "missing-profile", "app", "ChatGPT.exe");
  mkdirSync(codexPlusPlus, { recursive: true });
  mkdirSync(fakeApp, { recursive: true });
  mkdirSync(desktop, { recursive: true });
  mkdirSync(startMenu, { recursive: true });
  mkdirSync(currentMirror, { recursive: true });
  mkdirSync(dirname(staleApp), { recursive: true });
  writeFileSync(launcher, "");
  writeFileSync(actualApp, "");
  writeFileSync(currentMirrorApp, "");
  writeFileSync(staleApp, "");

  const runPowerShell = (args) => spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        USERPROFILE: appData,
        CODEX_SHINOBU_DESKTOP: desktop,
      },
    },
  );

  try {
    const escapePowerShell = (value) => value.replaceAll("'", "''");
    const createShortcut = runPowerShell([
      "-Command",
      `$shell=New-Object -ComObject WScript.Shell; ` +
      `$shortcut=$shell.CreateShortcut('${escapePowerShell(shortcutPath)}'); $shortcut.TargetPath='${escapePowerShell(launcher)}'; $shortcut.WorkingDirectory='${escapePowerShell(fakeApp)}'; $shortcut.Save(); ` +
      `$stale=$shell.CreateShortcut('${escapePowerShell(startMenuShortcutPath)}'); $stale.TargetPath='${escapePowerShell(staleApp)}'; $stale.Save()`,
    ]);
    assert.equal(createShortcut.status, 0, createShortcut.stderr || createShortcut.stdout);

    const first = runPowerShell(["-File", join(projectRoot, "install.ps1")]);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.ok(existsSync(join(destination, manifest.main)));
    assert.ok(existsSync(join(destination, "assets", "shinobu-icon.svg")));
    assert.ok(existsSync(join(destination, "assets", "preview.png")));
    assert.ok(existsSync(join(destination, "docs", "WINDOWS-USER-GUIDE.md")));
    assert.ok(existsSync(join(destination, "docs", "TROUBLESHOOTING.md")));
    const installedReadme = readFileSync(join(destination, "README.md"), "utf8");
    const localReadmeTargets = [...installedReadme.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)]
      .map((match) => match[1].split("#", 1)[0])
      .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/i.test(target));
    for (const target of localReadmeTargets) {
      assert.ok(existsSync(join(destination, target)), `installed README link is missing ${target}`);
    }
    const shortcutTarget = runPowerShell([
      "-Command",
      `$shell=New-Object -ComObject WScript.Shell; $shell.CreateShortcut('${escapePowerShell(shortcutPath)}').TargetPath`,
    ]);
    assert.equal(shortcutTarget.status, 0, shortcutTarget.stderr || shortcutTarget.stdout);
    assert.equal(shortcutTarget.stdout.trim(), currentMirrorApp);
    const repairedStaleTarget = runPowerShell([
      "-Command",
      `$shell=New-Object -ComObject WScript.Shell; $shell.CreateShortcut('${escapePowerShell(startMenuShortcutPath)}').TargetPath`,
    ]);
    assert.equal(repairedStaleTarget.status, 0, repairedStaleTarget.stderr || repairedStaleTarget.stdout);
    assert.equal(repairedStaleTarget.stdout.trim(), currentMirrorApp);

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
      "Analyze-Codex.cmd",
      "Optimize-Codex.cmd",
      "Uninstall-Theme.cmd",
      "uninstall.ps1",
      "ASSET-LICENSE.md",
      join("assets", "shinobu-icon.svg"),
      join("assets", "shinobu-hero-safe-landscape.webp"),
      join("docs", "AUTO-PALETTE.md"),
      join("docs", "VISUAL-QA.md"),
      join("docs", "CODEX-WINDOWS-OPTIMIZER.md"),
      join("docs", "WINDOWS-USER-GUIDE.md"),
      join("docs", "TROUBLESHOOTING.md"),
      join("docs", "RELEASE-CHECKLIST.md"),
      join("tools", "Optimize-Codex.ps1"),
    ]) {
      assert.ok(existsSync(join(staging, relative)), `release is missing ${relative}`);
    }
    for (const forbidden of [
      join("assets", "shinobu-hero-source.png"),
      join("WindowsApps", "app.asar"),
      join("User Data", "Local Storage"),
      join(".codex", "sessions"),
    ]) {
      assert.equal(existsSync(join(staging, forbidden)), false, `release must not include ${forbidden}`);
    }
    assert.ok(existsSync(zip));
    assert.ok(existsSync(checksum));
    const checksumText = readFileSync(checksum, "ascii").trim();
    assert.match(
      checksumText,
      new RegExp(`^[0-9a-f]{64}  ${folderName}-windows\\.zip$`),
    );
    const expectedHash = checksumText.split(/\s+/)[0];
    const actualHash = createHash("sha256").update(readFileSync(zip)).digest("hex");
    assert.equal(actualHash, expectedHash);
  } finally {
    rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("install and uninstall reject an unsafe manifest id before touching paths", { skip: process.platform !== "win32" }, () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-shinobu-unsafe-manifest-"));
  const appData = join(tempRoot, "appdata");
  mkdirSync(appData, { recursive: true });
  const maliciousManifest = JSON.stringify({
    id: "..\\outside",
    main: "dist/index.js",
  });
  try {
    for (const script of ["install.ps1", "uninstall.ps1"]) {
      const packageRoot = join(tempRoot, script.replace(".ps1", ""));
      mkdirSync(packageRoot, { recursive: true });
      writeFileSync(join(packageRoot, script), readFileSync(join(projectRoot, script)));
      writeFileSync(join(packageRoot, "manifest.json"), maliciousManifest);
      const scriptArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(packageRoot, script)];
      const result = spawnSync(
        "powershell.exe",
        scriptArgs,
        { encoding: "utf8", env: { ...process.env, APPDATA: appData } },
      );
      assert.notEqual(result.status, 0, `${script} should reject an unsafe id`);
      assert.match(`${result.stderr}\n${result.stdout}`, /unsafe path characters/);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("uninstall refuses theme and data junctions before removing either tree", { skip: process.platform !== "win32" }, () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-shinobu-junction-test-"));
  const manifest = JSON.parse(readFileSync(join(projectRoot, "manifest.json"), "utf8"));
  const createJunction = (junction, target) => {
    mkdirSync(dirname(junction), { recursive: true });
    mkdirSync(target, { recursive: true });
    const escapePowerShell = (value) => value.replaceAll("'", "''");
    const linked = spawnSync("powershell.exe", [
      "-NoProfile", "-Command",
      `New-Item -ItemType Junction -Path '${escapePowerShell(junction)}' -Target '${escapePowerShell(target)}' | Out-Null`,
    ], {
      encoding: "utf8",
    });
    assert.equal(linked.status, 0, linked.stderr || linked.stdout);
  };
  const removeJunction = (junction) => {
    if (!existsSync(junction)) return;
    const removed = spawnSync("cmd.exe", ["/d", "/c", "rmdir", junction], {
      encoding: "utf8",
    });
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
  };
  const runUninstall = (appData, purgeData = false) => {
    const args = [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `& '${join(projectRoot, "uninstall.ps1").replaceAll("'", "''")}'${purgeData ? " -PurgeData" : ""} -Confirm:$false`,
    ];
    return spawnSync("powershell.exe", args, {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, APPDATA: appData },
    });
  };

  try {
    const themeCase = join(tempRoot, "theme-case");
    const themePath = join(themeCase, "codex-plusplus", "tweaks", manifest.id);
    const themeTarget = join(tempRoot, "outside-theme");
    const themeSentinel = join(themeTarget, "keep.txt");
    createJunction(themePath, themeTarget);
    writeFileSync(themeSentinel, "keep\n");
    const themeResult = runUninstall(themeCase);
    assert.notEqual(themeResult.status, 0, "theme junction should be rejected");
    assert.match(`${themeResult.stderr}\n${themeResult.stdout}`, /reparse point/i);
    assert.ok(existsSync(themeSentinel), "junction target must remain untouched");
    removeJunction(themePath);

    const dataCase = join(tempRoot, "data-case");
    const installedTheme = join(dataCase, "codex-plusplus", "tweaks", manifest.id);
    const dataPath = join(dataCase, "codex-plusplus", "tweak-data", manifest.id);
    const dataTarget = join(tempRoot, "outside-data");
    const installedSentinel = join(installedTheme, "keep.txt");
    const dataSentinel = join(dataTarget, "keep.txt");
    mkdirSync(installedTheme, { recursive: true });
    writeFileSync(installedSentinel, "keep\n");
    createJunction(dataPath, dataTarget);
    writeFileSync(dataSentinel, "keep\n");
    const dataResult = runUninstall(dataCase, true);
    assert.notEqual(dataResult.status, 0, "data junction should be rejected");
    assert.match(`${dataResult.stderr}\n${dataResult.stdout}`, /reparse point/i);
    assert.ok(existsSync(installedSentinel), "preflight must happen before theme deletion");
    assert.ok(existsSync(dataSentinel), "data junction target must remain untouched");
    removeJunction(dataPath);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("optimizer confirmation refusal never closes a Codex process", { skip: process.platform !== "win32" }, () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-shinobu-confirm-test-"));
  const codexHome = join(tempRoot, ".codex");
  const webProfile = join(tempRoot, "web", "Codex");
  const cacheFile = join(webProfile, "Default", "Cache", "keep.bin");
  const stoppedMarker = join(tempRoot, "stop-process-was-called.txt");
  const scriptPath = join(projectRoot, "tools", "Optimize-Codex.ps1");
  const escapePowerShell = (value) => value.replaceAll("'", "''");

  try {
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, "keep\n");
    const command = [
      "function global:Get-Process { [CmdletBinding()] param([string[]]$Name) if ($Name -contains 'ChatGPT') { [pscustomobject]@{ ProcessName='ChatGPT'; Path='C:\\OpenAI.Codex\\ChatGPT.exe'; WorkingSet64=1; PrivateMemorySize64=1 } } }",
      `function global:Stop-Process { [CmdletBinding()] param([Parameter(ValueFromPipeline=$true)]$InputObject, [switch]$Force) process { Set-Content -LiteralPath '${escapePowerShell(stoppedMarker)}' -Value 'stopped' } }`,
      `& '${escapePowerShell(scriptPath)}' -Mode Optimize -CodexHome '${escapePowerShell(codexHome)}' ` +
        `-WebProfile '${escapePowerShell(webProfile)}' -AllowCustomPaths -ForceClose -Confirm:$true`,
    ].join("; ");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { cwd: projectRoot, encoding: "utf8", input: "N\r\n" },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Confirmation declined/);
    assert.equal(existsSync(stoppedMarker), false, "Stop-Process must not run after confirmation refusal");
    assert.equal(readFileSync(cacheFile, "utf8"), "keep\n");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("optimizer completes the confirmed transaction without a post-shutdown prompt", { skip: process.platform !== "win32" }, () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "codex-shinobu-confirm-yes-test-"));
  const codexHome = join(tempRoot, ".codex");
  const webProfile = join(tempRoot, "web", "Codex");
  const cacheFile = join(webProfile, "Default", "Cache", "remove.bin");
  const stoppedMarker = join(tempRoot, "stop-process-was-called.txt");
  const scriptPath = join(projectRoot, "tools", "Optimize-Codex.ps1");
  const escapePowerShell = (value) => value.replaceAll("'", "''");

  try {
    mkdirSync(codexHome, { recursive: true });
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, "remove\n");
    const command = [
      "$global:CodexStopped = $false",
      "function global:Get-Process { [CmdletBinding()] param([string[]]$Name) if (-not $global:CodexStopped -and $Name -contains 'ChatGPT') { [pscustomobject]@{ ProcessName='ChatGPT'; Path='C:\\OpenAI.Codex\\ChatGPT.exe'; WorkingSet64=1; PrivateMemorySize64=1 } } }",
      `function global:Stop-Process { [CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact='High')] param([Parameter(ValueFromPipeline=$true)]$InputObject, [switch]$Force) process { if ($PSCmdlet.ShouldProcess('mock Codex', 'Stop')) { $global:CodexStopped=$true; Set-Content -LiteralPath '${escapePowerShell(stoppedMarker)}' -Value 'stopped' } } }`,
      `& '${escapePowerShell(scriptPath)}' -Mode Optimize -CodexHome '${escapePowerShell(codexHome)}' ` +
        `-WebProfile '${escapePowerShell(webProfile)}' -AllowCustomPaths -ForceClose -Confirm:$true`,
    ].join("; ");
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
      { cwd: projectRoot, encoding: "utf8", input: "Y\r\n" },
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(existsSync(stoppedMarker), "approved maintenance should close the mocked Codex process");
    assert.equal(existsSync(cacheFile), false, "the one confirmed transaction should finish without another prompt");
    assert.match(result.stdout, /Optimization completed/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
