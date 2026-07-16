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
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", scriptPath,
      "-Mode", "Analyze",
      "-CodexHome", codexHome,
      "-WebProfile", webProfile,
    ]);

    assert.match(stdout, /Read-only analysis completed/);
    assert.match(stdout, /ActiveLogDatabaseMB\s*:\s*1/);
    assert.equal((await readFile(logDb)).length, 1024 * 1024);
    assert.equal((await readFile(cacheFile)).length, 256 * 1024);
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
  assert.equal(properties.get("--shinobu-art-fit"), "cover");
  assert.equal(pages.length, 1);
  assert.equal(pages[0].title, "小忍主题");

  module.exports.stop();
  assert.equal(appended[0].removed, true);
  assert.equal(attributes.has("data-shinobu-theme"), false);
  assert.equal(properties.has("--shinobu-art-fit"), false);
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
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /var\(--shinobu-art-image\)/);
  assert.match(css, /thread-scroll-container/);
  assert.match(css, /background-image:[\s\S]*var\(--shinobu-art-image\)/);
  assert.doesNotMatch(css, /shinobu-gallery-reserve/);
});
