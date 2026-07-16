import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const execFileAsync = promisify(execFile);

test("Windows optimizer analyzes a disposable profile without changing it", { skip: process.platform !== "win32" }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "codex-shinobu-optimizer-"));
  const codexHome = join(tempRoot, ".codex");
  const webProfile = join(tempRoot, "web", "Codex");
  const logDb = join(codexHome, "logs_2.sqlite");
  const cacheFile = join(webProfile, "Default", "Cache", "data.bin");
  try {
    await mkdir(join(codexHome, "sessions", "2026", "07", "16"), { recursive: true });
    await mkdir(join(webProfile, "Default", "Cache"), { recursive: true });
    await writeFile(logDb, Buffer.alloc(1024 * 1024));
    await writeFile(cacheFile, Buffer.alloc(256 * 1024));
    await writeFile(join(codexHome, "sessions", "2026", "07", "16", "rollout-test.jsonl"), "{}\n");

    const scriptPath = new URL("../tools/Optimize-Codex.ps1", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
    await assert.rejects(
      execFileAsync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", scriptPath,
        "-Mode", "Analyze",
        "-CodexHome", codexHome,
        "-WebProfile", webProfile,
      ]),
      /Custom maintenance roots require -AllowCustomPaths/,
    );
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-Mode", "Analyze",
      "-CodexHome", codexHome,
      "-WebProfile", webProfile,
      "-AllowCustomPaths",
    ]);

    assert.match(stdout, /Read-only analysis completed/);
    assert.match(stdout, /ActiveLogDatabaseMB\s*:\s*1/);
    assert.equal((await readFile(logDb)).length, 1024 * 1024);
    assert.equal((await readFile(cacheFile)).length, 256 * 1024);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("Windows optimizer rotates main plus WAL logs and clears exact browser caches", { skip: process.platform !== "win32" }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "codex-shinobu-optimize-"));
  const codexHome = join(tempRoot, ".codex");
  const webProfile = join(tempRoot, "web", "Codex");
  const sessionFile = join(codexHome, "sessions", "keep.jsonl");
  const logMain = join(codexHome, "logs_2.sqlite");
  const logWal = `${logMain}-wal`;
  const partitionCache = join(webProfile, "Default", "Partitions", "codex-browser-app", "Cache", "entry.bin");
  try {
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(join(webProfile, "Default", "Partitions", "codex-browser-app", "Cache"), { recursive: true });
    await writeFile(sessionFile, "keep\n");
    await writeFile(logMain, Buffer.alloc(700 * 1024));
    await writeFile(logWal, Buffer.alloc(700 * 1024));
    await writeFile(partitionCache, Buffer.alloc(64 * 1024));

    const scriptPath = new URL("../tools/Optimize-Codex.ps1", import.meta.url).pathname.replace(/^\/(.:)/, "$1");
    const escapePowerShell = (value) => value.replaceAll("'", "''");
    const command = [
      "function global:Get-Process { [CmdletBinding()] param([string[]]$Name) @() }",
      `& '${escapePowerShell(scriptPath)}' -Mode Optimize -CodexHome '${escapePowerShell(codexHome)}' ` +
        `-WebProfile '${escapePowerShell(webProfile)}' -AllowCustomPaths -LogThresholdMB 1`,
    ].join("; ");
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command]);

    assert.match(stdout, /Backed up and rotated 1\.4 MB/);
    await assert.rejects(readFile(logMain));
    await assert.rejects(readFile(logWal));
    await assert.rejects(readFile(partitionCache));
    assert.equal(await readFile(sessionFile, "utf8"), "keep\n");
    const backupRoot = join(codexHome, "maintenance-backups");
    const backupDirs = await (await import("node:fs/promises")).readdir(backupRoot);
    assert.equal(backupDirs.length, 1);
    assert.equal((await readFile(join(backupRoot, backupDirs[0], "logs_2.sqlite"))).length, 700 * 1024);
    assert.equal((await readFile(join(backupRoot, backupDirs[0], "logs_2.sqlite-wal"))).length, 700 * 1024);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("manifest is a valid renderer tweak with an existing entry", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.id, "io.github.master1st.codex-shinobu-theme");
  assert.equal(manifest.scope, "renderer");
  assert.equal(manifest.githubRepo, "Master-1st/codex-shinobu-theme");
  assert.deepEqual(manifest.permissions, ["settings", "filesystem"]);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  await readFile(new URL(`../${manifest.main}`, import.meta.url));
});

test("built theme is self-contained and exposes the local artwork interface", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  assert.match(source, /CODEX_SHINOBU_THEME v1/);
  assert.match(source, /data:image\/webp;base64,/);
  assert.match(source, /选择本地图片/);
  assert.match(source, /根据图片自动配色/);
  assert.match(source, /性能优先/);
  assert.match(source, /buildPaletteFromPixels/);
  assert.match(source, /api\.fs\.write\(ARTWORK_FILE/);
  assert.doesNotMatch(source, /__THEME_CSS_JSON__|__SHINOBU_HERO_DATA_URI__/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test("renderer lifecycle installs and removes one scoped style", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const attributes = new Map();
  const properties = new Map();
  const appended = [];
  const rootElement = {
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  const document = {
    documentElement: rootElement,
    head: { appendChild: (element) => appended.push(element) },
    createElement: (tag) => ({
      tag,
      dataset: {},
      style: {},
      remove() { this.removed = true; },
    }),
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, document, console });

  const pages = [];
  const logs = [];
  const api = {
    process: "renderer",
    manifest: { id: "io.github.master1st.codex-shinobu-theme" },
    storage: {
      get: (_key, fallback) => fallback,
      set() {},
      delete() {},
      all: () => ({}),
    },
    fs: {
      exists: async () => false,
      read: async () => "{}",
      write: async () => {},
    },
    settings: { registerPage: (page) => pages.push(page) },
    log: {
      info: (...args) => logs.push(args),
      warn: (...args) => logs.push(args),
      error: (...args) => logs.push(args),
    },
  };

  await module.exports.start(api);
  assert.equal(appended.length, 1);
  assert.equal(attributes.get("data-shinobu-theme"), "active");
  assert.equal(attributes.get("data-shinobu-motion"), "on");
  assert.equal(attributes.get("data-shinobu-performance"), "on");
  assert.equal(attributes.get("data-shinobu-auto-palette"), "on");
  assert.equal(properties.get("--shinobu-art-fit"), "cover");
  assert.equal(pages.length, 1);
  assert.equal(pages[0].title, "小忍主题");

  module.exports.stop();
  assert.equal(appended[0].removed, true);
  assert.equal(attributes.has("data-shinobu-theme"), false);
  assert.equal(attributes.has("data-shinobu-auto-palette"), false);
  assert.equal(attributes.has("data-shinobu-performance"), false);
  assert.equal(properties.has("--shinobu-art-fit"), false);
});

test("renderer layout tracking applies and removes an overlay-sidebar offset", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const makeStyle = () => {
    const values = new Map();
    return {
      values,
      setProperty: (name, value) => values.set(name, value),
      removeProperty: (name) => values.delete(name),
    };
  };
  const rootStyle = makeStyle();
  const threadStyle = makeStyle();
  const rootAttributes = new Map();
  const threadAttributes = new Map();
  const rootElement = {
    clientWidth: 1963,
    style: rootStyle,
    setAttribute: (name, value) => rootAttributes.set(name, value),
    removeAttribute: (name) => rootAttributes.delete(name),
  };
  const sidebar = {
    getBoundingClientRect: () => ({ left: 0, right: 330, top: 0, bottom: 1188, width: 330, height: 1188 }),
  };
  const thread = {
    style: threadStyle,
    setAttribute: (name, value) => threadAttributes.set(name, value),
    removeAttribute: (name) => threadAttributes.delete(name),
    getBoundingClientRect: () => ({ left: 146, right: 1963, top: 59, bottom: 1188, width: 1817, height: 1129 }),
  };
  const mainSurface = {
    getBoundingClientRect: () => ({ left: 146, right: 1963, top: 0, bottom: 1188, width: 1817, height: 1188 }),
  };
  const document = {
    documentElement: rootElement,
    body: {},
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, style: {}, remove() {} }),
    querySelectorAll: (selector) => {
      if (selector === ".app-shell-left-panel") return [sidebar];
      if (selector === ".thread-scroll-container") return [thread];
      if (selector === ".main-surface, .browser-main-surface") return [mainSurface];
      return [];
    },
  };
  const observed = [];
  let disconnected = false;
  class FakeResizeObserver {
    constructor(callback) { this.callback = callback; }
    observe(element) { observed.push(element); }
    disconnect() { disconnected = true; }
  }
  const window = {
    innerWidth: 1963,
    addEventListener() {},
    removeEventListener() {},
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    document,
    window,
    ResizeObserver: FakeResizeObserver,
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    console,
  });

  await module.exports.start({
    process: "renderer",
    manifest: { id: "io.github.master1st.codex-shinobu-theme" },
    storage: { get: (_key, fallback) => fallback, set() {} },
    fs: { exists: async () => false, read: async () => "{}", write: async () => {} },
    settings: { registerPage() {} },
    log: { info() {}, warn() {}, error() {} },
  });

  assert.equal(rootAttributes.get("data-shinobu-layout"), "centered");
  assert.equal(threadAttributes.get("data-shinobu-rail-mode"), "centered");
  assert.equal(threadStyle.values.get("--shinobu-rail-inline-start"), "570.50px");
  assert.equal(threadStyle.values.get("--shinobu-rail-inline-size"), "860.00px");
  assert.ok(observed.includes(rootElement));
  assert.ok(observed.includes(sidebar));
  assert.ok(observed.includes(thread));

  module.exports.stop();
  assert.equal(disconnected, true);
  assert.equal(rootAttributes.has("data-shinobu-layout"), false);
  assert.equal(threadAttributes.has("data-shinobu-rail-mode"), false);
  assert.equal(threadStyle.values.has("--shinobu-rail-inline-start"), false);
  assert.equal(threadStyle.values.has("--shinobu-rail-inline-size"), false);
});

test("task header marker is cleared when navigation removes the thread title", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const rootAttributes = new Map();
  const rootProperties = new Map();
  const headerAttributes = new Map();
  const titleNode = {
    nodeType: 1,
    matches: (selector) => selector.includes("[data-thread-title]"),
  };
  let titlePresent = true;
  const header = {
    matches: (selector) => selector === ".app-header-tint",
    closest: (selector) => selector === ".app-header-tint" ? header : null,
    querySelector: () => titlePresent ? titleNode : null,
    hasAttribute: (name) => headerAttributes.has(name),
    getAttribute: (name) => headerAttributes.get(name),
    setAttribute: (name, value) => headerAttributes.set(name, value),
    removeAttribute: (name) => headerAttributes.delete(name),
  };
  const rootElement = {
    clientWidth: 1280,
    style: {
      setProperty: (name, value) => rootProperties.set(name, value),
      removeProperty: (name) => rootProperties.delete(name),
    },
    hasAttribute: (name) => rootAttributes.has(name),
    getAttribute: (name) => rootAttributes.get(name),
    setAttribute: (name, value) => rootAttributes.set(name, value),
    removeAttribute: (name) => rootAttributes.delete(name),
  };
  const document = {
    documentElement: rootElement,
    body: {},
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, style: {}, remove() {} }),
    querySelectorAll: (selector) => selector === ".app-header-tint" ? [header] : [],
  };
  let mutationCallback = null;
  class FakeMutationObserver {
    constructor(callback) { mutationCallback = callback; }
    observe() {}
    disconnect() {}
  }
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    document,
    MutationObserver: FakeMutationObserver,
    console,
  });

  await module.exports.start({
    process: "renderer",
    manifest: { id: "io.github.master1st.codex-shinobu-theme" },
    storage: { get: (_key, fallback) => fallback, set() {} },
    fs: { exists: async () => false, read: async () => "{}", write: async () => {} },
    settings: { registerPage() {} },
    log: { info() {}, warn() {}, error() {} },
  });

  assert.equal(headerAttributes.get("data-shinobu-thread-header"), "true");
  titlePresent = false;
  mutationCallback([{ target: header, addedNodes: [], removedNodes: [titleNode] }]);
  assert.equal(headerAttributes.has("data-shinobu-thread-header"), false);

  module.exports.stop();
});

test("automatic palette produces distinct colors with readable text", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, console });
  const pixels = [];
  const add = (count, color) => {
    for (let index = 0; index < count; index += 1) pixels.push(...color, 255);
  };
  add(3000, [244, 233, 111]);
  add(1300, [121, 189, 152]);
  add(884, [220, 130, 152]);

  const palette = module.exports.__test.buildPaletteFromPixels(Uint8ClampedArray.from(pixels));
  assert.equal(module.exports.__test.isValidPalette(palette), true);
  assert.notEqual(palette.primary, palette.secondary);
  assert.notEqual(palette.secondary, palette.accent);
  assert.ok(module.exports.__test.contrastRatio(palette.ink, palette.surface) >= 7);
  assert.ok(module.exports.__test.contrastRatio(palette.muted, palette.surface) >= 4.5);
});

test("reading rail centers inside the visible workspace when the window is restored", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, console });

  const restored = module.exports.__test.calculateReadingRail({
    viewportWidth: 1963,
    threadLeft: 146,
    threadRight: 1963,
    sidebarRight: 330,
  });
  assert.equal(restored.mode, "centered");
  assert.ok(restored.absoluteLeft >= 354, "reading rail must start after the visible sidebar");
  assert.equal(restored.width, 860, "restored window should use the centered maximum reading width");
  assert.ok(Math.abs((restored.absoluteLeft + restored.absoluteRight) / 2 - (354 + 1939) / 2) < 0.01, "reading rail must be centered in the visible work area");

  const compact = module.exports.__test.calculateReadingRail({
    viewportWidth: 640,
    threadLeft: 80,
    threadRight: 640,
    sidebarRight: 270,
  });
  assert.equal(compact.mode, "compact");
  assert.ok(compact.absoluteLeft >= 286, "compact content must still stay outside the sidebar");
  assert.ok(compact.absoluteRight <= 624, "compact content must remain inside the work area");
});

test("stored artwork palette applies and is fully removed on stop", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const attributes = new Map();
  const properties = new Map();
  const rootElement = {
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
  const document = {
    documentElement: rootElement,
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, style: {}, remove() {} }),
  };
  const palette = {
    version: 1,
    primary: "#f4e96f",
    primarySoft: "#fff5a8",
    secondary: "#79bd98",
    secondarySoft: "#dff1e6",
    accent: "#dc8298",
    surface: "#fffdf2",
    ink: "#33262c",
    muted: "#715f66",
    strong: "#3f7e5d",
    link: "#387654",
  };
  const store = new Map([["autoPaletteEnabled", true], ["layoutVersion", 2]]);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, document, console });
  await module.exports.start({
    process: "renderer",
    manifest: { id: "io.github.master1st.codex-shinobu-theme" },
    storage: {
      get: (key, fallback) => store.has(key) ? store.get(key) : fallback,
      set: (key, value) => store.set(key, value),
    },
    fs: {
      exists: async () => true,
      read: async () => JSON.stringify({ name: "custom.png", dataUrl: "data:image/webp;base64,AA==", palette }),
      write: async () => {},
    },
    settings: { registerPage() {} },
    log: { info() {}, warn() {}, error() {} },
  });

  assert.equal(properties.get("--shinobu-yellow"), palette.primary);
  assert.equal(properties.get("--shinobu-mint"), palette.secondary);
  assert.equal(properties.get("--shinobu-ink"), palette.ink);
  module.exports.stop();
  for (const variable of ["--shinobu-yellow", "--shinobu-mint", "--shinobu-blush", "--shinobu-cream", "--shinobu-ink"]) {
    assert.equal(properties.has(variable), false, `${variable} should be removed`);
  }
});

test("automatic palette can be disabled without leaving inline theme colors", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const attributes = new Map();
  const properties = new Map();
  const document = {
    documentElement: {
      style: {
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
      setAttribute: (name, value) => attributes.set(name, value),
      removeAttribute: (name) => attributes.delete(name),
    },
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, style: {}, remove() {} }),
  };
  const palette = {
    version: 1,
    primary: "#f4e96f",
    primarySoft: "#fff5a8",
    secondary: "#79bd98",
    secondarySoft: "#dff1e6",
    accent: "#dc8298",
    surface: "#fffdf2",
    ink: "#33262c",
    muted: "#715f66",
    strong: "#3f7e5d",
    link: "#387654",
  };
  const store = new Map([["autoPaletteEnabled", false], ["layoutVersion", 2]]);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, document, console });

  await module.exports.start({
    process: "renderer",
    manifest: { id: "io.github.master1st.codex-shinobu-theme" },
    storage: {
      get: (key, fallback) => store.has(key) ? store.get(key) : fallback,
      set: (key, value) => store.set(key, value),
    },
    fs: {
      exists: async () => true,
      read: async () => JSON.stringify({ name: "custom.png", dataUrl: "data:image/webp;base64,AA==", palette }),
      write: async () => {},
    },
    settings: { registerPage() {} },
    log: { info() {}, warn() {}, error() {} },
  });

  assert.equal(attributes.get("data-shinobu-auto-palette"), "off");
  assert.equal(properties.get("--shinobu-art-image"), 'url("data:image/webp;base64,AA==")');
  for (const variable of ["--shinobu-yellow", "--shinobu-mint", "--shinobu-blush", "--shinobu-cream", "--shinobu-ink"]) {
    assert.equal(properties.has(variable), false, `${variable} should use the bundled fallback`);
  }
});

test("legacy local artwork is migrated to a readable palette on device", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const pixels = [];
  const add = (count, color) => {
    for (let index = 0; index < count; index += 1) pixels.push(...color, 255);
  };
  add(3000, [244, 233, 111]);
  add(1300, [121, 189, 152]);
  add(884, [220, 130, 152]);
  const sampledPixels = Uint8ClampedArray.from(pixels);
  const properties = new Map();
  const writes = [];
  const rootElement = {
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    setAttribute() {},
    removeAttribute() {},
  };
  const canvasContext = {
    drawImage() {},
    getImageData: () => ({ data: sampledPixels }),
  };
  const document = {
    documentElement: rootElement,
    head: { appendChild() {} },
    createElement: (tag) => tag === "canvas"
      ? { width: 0, height: 0, getContext: () => canvasContext }
      : { dataset: {}, style: {}, remove() {} },
  };
  class FakeImage {
    naturalWidth = 1920;
    naturalHeight = 1080;
    set src(value) {
      this.currentSrc = value;
      this.onload();
    }
  }
  const store = new Map([["autoPaletteEnabled", true], ["layoutVersion", 2]]);
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, document, Image: FakeImage, console });

  await module.exports.start({
    process: "renderer",
    manifest: { id: "io.github.master1st.codex-shinobu-theme" },
    storage: {
      get: (key, fallback) => store.has(key) ? store.get(key) : fallback,
      set: (key, value) => store.set(key, value),
    },
    fs: {
      exists: async () => true,
      read: async () => JSON.stringify({ name: "legacy.png", dataUrl: "data:image/png;base64,AA==" }),
      write: async (...args) => writes.push(args),
    },
    settings: { registerPage() {} },
    log: { info() {}, warn() {}, error() {} },
  });

  assert.equal(writes.length, 1);
  const migrated = JSON.parse(writes[0][1]);
  assert.equal(module.exports.__test.isValidPalette(migrated.palette), true);
  assert.equal(properties.get("--shinobu-yellow"), migrated.palette.primary);
  assert.ok(module.exports.__test.contrastRatio(migrated.palette.ink, migrated.palette.surface) >= 7);
  assert.ok(module.exports.__test.contrastRatio(migrated.palette.muted, migrated.palette.surface) >= 4.5);
});

test("unreadable legacy artwork keeps the default palette instead of breaking startup", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const properties = new Map();
  const warnings = [];
  const document = {
    documentElement: {
      style: {
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: (name) => properties.delete(name),
      },
      setAttribute() {},
      removeAttribute() {},
    },
    head: { appendChild() {} },
    createElement: () => ({ dataset: {}, style: {}, remove() {} }),
  };
  class BrokenImage {
    set src(_value) {
      this.onerror();
    }
  }
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, document, Image: BrokenImage, console });

  await module.exports.start({
    process: "renderer",
    manifest: { id: "io.github.master1st.codex-shinobu-theme" },
    storage: { get: (key, fallback) => key === "layoutVersion" ? 2 : fallback, set() {} },
    fs: {
      exists: async () => true,
      read: async () => JSON.stringify({ name: "broken.png", dataUrl: "data:image/png;base64,AA==", palette: { primary: "bad" } }),
      write: async () => assert.fail("invalid artwork must not overwrite the local record"),
    },
    settings: { registerPage() {} },
    log: { info() {}, warn: (...args) => warnings.push(args), error() {} },
  });

  assert.equal(warnings.length, 1);
  assert.equal(properties.has("--shinobu-yellow"), false);
  assert.equal(properties.has("--shinobu-ink"), false);
  assert.equal(properties.get("--shinobu-art-image"), 'url("data:image/png;base64,AA==")');
});

test("avatar overlay renderer is left untouched", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  const appended = [];
  const document = {
    documentElement: {
      style: { setProperty() {}, removeProperty() {} },
      setAttribute() {},
      removeAttribute() {},
    },
    head: { appendChild: (element) => appended.push(element) },
    createElement: () => ({ dataset: {}, style: {}, remove() {} }),
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    document,
    location: { href: "app://-/index.html?initialRoute=%2Favatar-overlay" },
    decodeURIComponent,
    console,
  });

  const logs = [];
  await module.exports.start({
    process: "renderer",
    log: { info: (...args) => logs.push(args) },
  });

  assert.equal(appended.length, 0);
  assert.match(logs.flat().join(" "), /skipped in auxiliary renderer/);
});

test("theme CSS scopes stable Codex surfaces and responsive fallbacks", async () => {
  const css = await readFile(new URL("../dist/theme.css", import.meta.url), "utf8");
  for (const selector of [
    ".app-shell-left-panel",
    ".main-surface",
    ".composer-surface-chrome",
    "[data-user-message-bubble]",
    "[data-local-conversation-final-assistant]",
  ]) {
    assert.ok(css.includes(selector), `missing selector ${selector}`);
  }
  assert.match(css, /@media \(min-width: 800px\)[\s\S]*32vw/);
  assert.match(css, /@media \(max-width: 799px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /var\(--shinobu-art-image\)/);
  assert.match(css, /thread-scroll-container/);
  assert.match(css, /#root[\s\S]*var\(--shinobu-art-image\)/);
  assert.match(css, /data-mcp-app-portal-target="true"/);
  assert.match(css, /data-pip-obstacle="thread-footer"/);
  assert.doesNotMatch(css, /radial-gradient\(circle, #fff 0 1px/);
  const sharedHeaderRule = css.match(/html\[data-shinobu-theme="active"\] \.app-header-tint \{([\s\S]*?)\}/)?.[1] || "";
  assert.doesNotMatch(sharedHeaderRule, /position:|width:|min-height:|margin:|padding:/);
  assert.match(css, /app-header-tint\[data-app-shell-header-edge-scroll\][\s\S]*position: fixed !important/);
  assert.match(css, /app-header-tint\[data-app-shell-header-edge-scroll\][\s\S]*top: calc\(var\(--inset-toolbar-sm, 36px\) \+ 8px\) !important/);
  assert.match(css, /app-header-tint\[data-app-shell-header-edge-scroll\][\s\S]*right: 24px !important[\s\S]*left: auto !important/);
  assert.match(css, /app-header-tint\[data-app-shell-header-edge-scroll\][\s\S]*width: clamp\(320px, 33\.333vw, 680px\)/);
  assert.match(css, /app-header-tint\[data-shinobu-thread-header="true"\][\s\S]*height: 44px !important[\s\S]*margin: 0 !important/);
  assert.doesNotMatch(css, /app-header-tint:has/);
  assert.match(css, /data-shinobu-performance="on"[\s\S]*\[data-local-conversation-final-assistant\][\s\S]*backdrop-filter: none !important/);
  assert.match(css, /--shinobu-rail-inline-start/);
  assert.match(css, /--shinobu-rail-inline-size/);
  assert.match(css, /data-shinobu-layout="compact"/);
  assert.match(css, /color-mix\(in srgb, var\(--shinobu-/);
  assert.match(css, /background-image:[\s\S]*var\(--shinobu-art-image\)/);
  assert.doesNotMatch(css, /shinobu-gallery-reserve/);
});

test("runtime tracking filters noisy transitions and releases detached resize targets", async () => {
  const source = await readFile(new URL("../dist/index.js", import.meta.url), "utf8");
  assert.match(source, /transitionend", handleLayoutTransition/);
  assert.doesNotMatch(source, /transitionend", scheduleReadingRailUpdate/);
  assert.match(source, /layoutResizeObserver\.unobserve/);
  assert.match(source, /LAYOUT_TRANSITION_PROPERTIES/);
  assert.match(source, /if \(node\.closest\?\.\(LAYOUT_SURFACE_SELECTOR\)\) continue/);
});

test("Windows-only docs and package metadata stay on the same release version", async () => {
  const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  assert.equal(pkg.version, manifest.version);
  assert.match(pkg.description, /Windows-only/);
  assert.match(readme, /只能用于 Windows/);
  assert.match(readme, /不支持 macOS、Linux\/WSL/);
  assert.match(readme, new RegExp(`v${manifest.version.replaceAll(".", "\\.")}`));
  assert.match(
    readme,
    new RegExp(
      `https://github\\.com/Master-1st/codex-shinobu-theme/releases/download/v${manifest.version.replaceAll(".", "\\.")}/` +
      `codex-shinobu-theme-v${manifest.version.replaceAll(".", "\\.")}-windows\\.zip`,
    ),
  );
  assert.match(changelog, new RegExp(`## ${manifest.version.replaceAll(".", "\\.")}`));
  for (const path of [
    "../docs/WINDOWS-USER-GUIDE.md",
    "../docs/TROUBLESHOOTING.md",
    "../docs/RELEASE-CHECKLIST.md",
    "../ASSET-LICENSE.md",
    "../Analyze-Codex.cmd",
    "../Uninstall-Theme.cmd",
    "../.github/workflows/windows.yml",
  ]) {
    await readFile(new URL(path, import.meta.url));
  }
  const workflow = await readFile(new URL("../.github/workflows/windows.yml", import.meta.url), "utf8");
  assert.match(workflow, /permissions:\s*\r?\n\s+contents: read/);
  assert.match(workflow, /run: npm run package/);
  assert.doesNotMatch(workflow, /run: npm test/);
});

test("visual QA preview contains every supported state", async () => {
  const preview = await readFile(new URL("../preview/index.html", import.meta.url), "utf8");
  for (const state of ["normal", "split", "long", "shrink", "approval", "menu", "dialog", "settings"]) {
    assert.ok(preview.includes(`data-state=\"${state}\"`) || preview.includes(`data-state="${state}"`) || preview.includes(`state=\"${state}\"`) || preview.includes(`state === \"${state}\"`) || preview.includes(`data-state="${state}"`) || preview.includes(`body[data-state=\"${state}\"]`), `missing preview state ${state}`);
  }
  assert.match(preview, /palette.*blue/);
  assert.match(preview, /data-codex-approval-surface/);
  assert.match(preview, /role="dialog"/);
  assert.match(preview, /data-preview-detail-composer="true"/);
  assert.match(preview, /window-toolbar app-header-tint/);
  assert.match(preview, /data-app-shell-header-edge-scroll="true"/);
  assert.match(preview, /\.workspace \{[^}]*grid-row: 2/);
  assert.match(preview, /app-header-tint fixed top-toolbar-sm right-0/);
  assert.match(preview, /body\[data-state="settings"\] \.workspace \{ display: none; \}/);
  assert.match(preview, /grid-template-rows: minmax\(0, 1fr\) auto/);
});
