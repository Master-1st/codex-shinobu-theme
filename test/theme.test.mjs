import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

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
  assert.match(css, /padding-right: var\(--shinobu-gallery-reserve\)/);
  assert.match(css, /body:has\(\.main-surface \.thread-scroll-container\)::before/);
});
