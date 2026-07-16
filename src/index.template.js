const STYLE_ID = "codex-shinobu-theme-style";
const ARTWORK_FILE = "artwork.json";
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_EDGE = 2560;
const CSS_TEXT = __THEME_CSS_JSON__;

const POSITION_VALUES = Object.freeze({
  right: "center right",
  center: "center center",
  left: "center left",
});

const PALETTE_VARIABLES = Object.freeze({
  primary: "--shinobu-yellow",
  primarySoft: "--shinobu-yellow-soft",
  secondary: "--shinobu-mint",
  secondarySoft: "--shinobu-mint-soft",
  accent: "--shinobu-blush",
  surface: "--shinobu-cream",
  ink: "--shinobu-ink",
  muted: "--shinobu-muted",
  strong: "--shinobu-strong",
  link: "--shinobu-link",
});

const REQUIRED_PALETTE_KEYS = Object.freeze(Object.keys(PALETTE_VARIABLES));
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

let styleElement = null;
let activeApi = null;
let artworkRecord = null;
let layoutResizeObserver = null;
let layoutMutationObserver = null;
let observedLayoutElements = null;
let layoutFrameId = null;
let layoutTimeoutIds = [];

const READING_RAIL = Object.freeze({
  safeRightRatio: 0.56,
  gap: 24,
  compactGap: 16,
  minimumSafeWidth: 360,
  maximumWidth: 860,
});

function rootElement() {
  return document.documentElement;
}

function isAuxiliaryRendererWindow() {
  if (typeof location === "undefined") return false;
  let href = String(location.href || "");
  try {
    href = decodeURIComponent(href);
  } catch {}
  return /[?&]initialRoute=\/?avatar-overlay(?:[&#]|$)/i.test(href);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function calculateReadingRail({ viewportWidth, threadLeft, threadRight, sidebarRight = 0 }) {
  const viewport = Math.max(1, finiteNumber(viewportWidth, 1));
  const leftEdge = clamp(finiteNumber(threadLeft), 0, viewport);
  const rightEdge = clamp(finiteNumber(threadRight, viewport), leftEdge, viewport);
  const visibleSidebarRight = clamp(finiteNumber(sidebarRight), 0, viewport);
  const safeStart = Math.max(leftEdge + READING_RAIL.gap, visibleSidebarRight + READING_RAIL.gap);
  const safeRight = Math.min(rightEdge - READING_RAIL.gap, viewport * READING_RAIL.safeRightRatio);
  const safeWidth = safeRight - safeStart;

  if (safeWidth >= READING_RAIL.minimumSafeWidth) {
    const width = Math.min(READING_RAIL.maximumWidth, safeWidth);
    return {
      mode: "rail",
      left: Math.max(READING_RAIL.gap, safeStart - leftEdge),
      width,
      absoluteLeft: safeStart,
      absoluteRight: safeStart + width,
    };
  }

  const compactStart = Math.max(
    leftEdge + READING_RAIL.compactGap,
    visibleSidebarRight + READING_RAIL.compactGap,
  );
  const compactRight = Math.max(compactStart, rightEdge - READING_RAIL.compactGap);
  return {
    mode: "compact",
    left: Math.max(READING_RAIL.compactGap, compactStart - leftEdge),
    width: Math.max(0, compactRight - compactStart),
    absoluteLeft: compactStart,
    absoluteRight: compactRight,
  };
}

function elementRect(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  const rect = element.getBoundingClientRect();
  const left = finiteNumber(rect.left);
  const right = finiteNumber(rect.right, left + finiteNumber(rect.width));
  const top = finiteNumber(rect.top);
  const bottom = finiteNumber(rect.bottom, top + finiteNumber(rect.height));
  return {
    left,
    right,
    top,
    bottom,
    width: Math.max(0, finiteNumber(rect.width, right - left)),
    height: Math.max(0, finiteNumber(rect.height, bottom - top)),
  };
}

function visibleSidebars(viewportWidth) {
  if (typeof document.querySelectorAll !== "function") return [];
  const result = [];
  for (const element of document.querySelectorAll(".app-shell-left-panel")) {
    const rect = elementRect(element);
    if (!rect || rect.width < 40 || rect.height < 80 || rect.right <= 0 || rect.left >= viewportWidth) continue;
    if (typeof getComputedStyle === "function") {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) continue;
    }
    result.push({ element, rect });
  }
  return result;
}

function observeLayoutElement(element) {
  if (!layoutResizeObserver || !observedLayoutElements || !element || observedLayoutElements.has(element)) return;
  observedLayoutElements.add(element);
  layoutResizeObserver.observe(element);
}

function updateReadingRail() {
  if (typeof document.querySelectorAll !== "function") return;
  const root = rootElement();
  const viewportWidth = Math.max(
    finiteNumber(root.clientWidth),
    typeof window !== "undefined" ? finiteNumber(window.innerWidth) : 0,
  );
  if (viewportWidth < 1) return;

  const sidebars = visibleSidebars(viewportWidth);
  const sidebarRight = sidebars.reduce((right, item) => Math.max(right, Math.min(viewportWidth, item.rect.right)), 0);
  const entries = [];
  for (const thread of document.querySelectorAll(".thread-scroll-container")) {
    const rect = elementRect(thread);
    if (!rect || rect.width < 1 || rect.height < 1) continue;
    const layout = calculateReadingRail({
      viewportWidth,
      threadLeft: rect.left,
      threadRight: rect.right,
      sidebarRight: sidebarRight > rect.left ? sidebarRight : 0,
    });
    thread.style?.setProperty("--shinobu-rail-inline-start", `${layout.left.toFixed(2)}px`);
    thread.style?.setProperty("--shinobu-rail-inline-size", `${layout.width.toFixed(2)}px`);
    thread.setAttribute?.("data-shinobu-rail-mode", layout.mode);
    entries.push({ thread, rect, layout });
    observeLayoutElement(thread);
  }

  if (!entries.length) {
    root.removeAttribute("data-shinobu-layout");
    return;
  }

  entries.sort((first, second) => first.rect.left - second.rect.left);
  const primary = entries[0];
  root.setAttribute("data-shinobu-layout", primary.layout.mode);
  root.style.setProperty("--shinobu-primary-rail-inline-start", `${primary.layout.left.toFixed(2)}px`);
  root.style.setProperty("--shinobu-primary-rail-inline-size", `${primary.layout.width.toFixed(2)}px`);

  for (const item of sidebars) observeLayoutElement(item.element);
  for (const surface of document.querySelectorAll(".main-surface, .browser-main-surface")) {
    observeLayoutElement(surface);
  }
}

function scheduleReadingRailUpdate() {
  if (layoutFrameId !== null) return;
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    layoutFrameId = window.requestAnimationFrame(() => {
      layoutFrameId = null;
      updateReadingRail();
    });
    return;
  }
  updateReadingRail();
}

function startLayoutTracking() {
  stopLayoutTracking();
  observedLayoutElements = new WeakSet();
  if (typeof ResizeObserver === "function") {
    layoutResizeObserver = new ResizeObserver(scheduleReadingRailUpdate);
    observeLayoutElement(rootElement());
  }
  if (typeof MutationObserver === "function" && document.body) {
    layoutMutationObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node?.nodeType !== 1) continue;
          if (node.matches?.(".thread-scroll-container, .app-shell-left-panel, .main-surface, .browser-main-surface") ||
              node.querySelector?.(".thread-scroll-container, .app-shell-left-panel, .main-surface, .browser-main-surface")) {
            scheduleReadingRailUpdate();
            return;
          }
        }
      }
    });
    layoutMutationObserver.observe(document.body, { childList: true, subtree: true });
  }
  if (typeof window !== "undefined") {
    window.addEventListener?.("resize", scheduleReadingRailUpdate, { passive: true });
    window.addEventListener?.("transitionend", scheduleReadingRailUpdate, true);
  }
  updateReadingRail();
  if (typeof setTimeout === "function") {
    layoutTimeoutIds = [250, 900].map((delay) => setTimeout(scheduleReadingRailUpdate, delay));
  }
}

function clearReadingRailState() {
  const root = rootElement();
  root.removeAttribute("data-shinobu-layout");
  root.style.removeProperty("--shinobu-primary-rail-inline-start");
  root.style.removeProperty("--shinobu-primary-rail-inline-size");
  if (typeof document.querySelectorAll !== "function") return;
  for (const element of document.querySelectorAll(".thread-scroll-container")) {
    element.removeAttribute?.("data-shinobu-rail-mode");
    element.style?.removeProperty("--shinobu-rail-inline-start");
    element.style?.removeProperty("--shinobu-rail-inline-size");
  }
}

function stopLayoutTracking() {
  layoutResizeObserver?.disconnect();
  layoutMutationObserver?.disconnect();
  layoutResizeObserver = null;
  layoutMutationObserver = null;
  observedLayoutElements = null;
  for (const timeoutId of layoutTimeoutIds) clearTimeout(timeoutId);
  layoutTimeoutIds = [];
  if (typeof window !== "undefined") {
    if (layoutFrameId !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(layoutFrameId);
    }
    window.removeEventListener?.("resize", scheduleReadingRailUpdate);
    window.removeEventListener?.("transitionend", scheduleReadingRailUpdate, true);
  }
  layoutFrameId = null;
  clearReadingRailState();
}

function rgbToHex({ r, g, b }) {
  const channel = (value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hexToRgb(value) {
  if (!HEX_COLOR.test(value || "")) return null;
  return {
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  };
}

function rgbToHsl({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (max === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  return { h: hue, s: saturation || 0, l: lightness };
}

function hslToRgb({ h, s, l }) {
  const hue = ((h % 360) + 360) % 360;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = l - chroma / 2;
  let channels;
  if (hue < 60) channels = [chroma, x, 0];
  else if (hue < 120) channels = [x, chroma, 0];
  else if (hue < 180) channels = [0, chroma, x];
  else if (hue < 240) channels = [0, x, chroma];
  else if (hue < 300) channels = [x, 0, chroma];
  else channels = [chroma, 0, x];
  return {
    r: (channels[0] + match) * 255,
    g: (channels[1] + match) * 255,
    b: (channels[2] + match) * 255,
  };
}

function mixRgb(from, to, amount) {
  const ratio = clamp(amount, 0, 1);
  return {
    r: from.r + (to.r - from.r) * ratio,
    g: from.g + (to.g - from.g) * ratio,
    b: from.b + (to.b - from.b) * ratio,
  };
}

function relativeLuminance(color) {
  const rgb = typeof color === "string" ? hexToRgb(color) : color;
  if (!rgb) return 0;
  const convert = (value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * convert(rgb.r) + 0.7152 * convert(rgb.g) + 0.0722 * convert(rgb.b);
}

function contrastRatio(first, second) {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrast(color, background, target) {
  const source = typeof color === "string" ? hexToRgb(color) : color;
  const backdrop = typeof background === "string" ? hexToRgb(background) : background;
  if (!source || !backdrop) return "#33262c";
  const toward = relativeLuminance(backdrop) > 0.42
    ? { r: 0, g: 0, b: 0 }
    : { r: 255, g: 255, b: 255 };
  for (let step = 0; step <= 20; step += 1) {
    const candidate = mixRgb(source, toward, step / 20);
    if (contrastRatio(candidate, backdrop) >= target) return rgbToHex(candidate);
  }
  return rgbToHex(toward);
}

function hueDistance(first, second) {
  const distance = Math.abs(first - second) % 360;
  return Math.min(distance, 360 - distance);
}

function colorDistance(first, second) {
  return Math.hypot(first.r - second.r, first.g - second.g, first.b - second.b);
}

function normalizeColor(rgb, minSaturation, minLightness, maxLightness) {
  const hsl = rgbToHsl(rgb);
  return hslToRgb({
    h: hsl.h,
    s: clamp(hsl.s, minSaturation, 0.88),
    l: clamp(hsl.l, minLightness, maxLightness),
  });
}

function buildPaletteFromPixels(pixelData) {
  const buckets = new Map();
  for (let index = 0; index < pixelData.length; index += 4) {
    const alpha = pixelData[index + 3];
    if (alpha < 160) continue;
    const r = pixelData[index];
    const g = pixelData[index + 1];
    const b = pixelData[index + 2];
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const clusters = [...buckets.values()]
    .filter((bucket) => bucket.count >= 2)
    .map((bucket) => {
      const rgb = {
        r: bucket.r / bucket.count,
        g: bucket.g / bucket.count,
        b: bucket.b / bucket.count,
      };
      return { rgb, hsl: rgbToHsl(rgb), count: bucket.count };
    })
    .sort((first, second) => second.count - first.count);

  if (!clusters.length) return null;
  const dominant = clusters[0];
  const colorful = clusters.filter((cluster) => cluster.hsl.s >= 0.16);
  const primarySource = dominant.hsl.s >= 0.16 ? dominant : (colorful[0] || dominant);

  const selectDistinct = (excluded, minHue, minDistance) => {
    const candidates = clusters
      .filter((cluster) => cluster.hsl.s >= 0.18)
      .filter((cluster) => excluded.every((item) =>
        hueDistance(cluster.hsl.h, item.hsl.h) >= minHue ||
        colorDistance(cluster.rgb, item.rgb) >= minDistance))
      .map((cluster) => ({
        cluster,
        score: cluster.count * (0.45 + cluster.hsl.s * 1.8),
      }))
      .sort((first, second) => second.score - first.score);
    return candidates[0]?.cluster || null;
  };

  const secondarySource = selectDistinct([primarySource], 36, 82) || {
    rgb: hslToRgb({ h: primarySource.hsl.h + 82, s: 0.48, l: 0.58 }),
    hsl: { h: (primarySource.hsl.h + 82) % 360, s: 0.48, l: 0.58 },
    count: 1,
  };
  const accentSource = selectDistinct([primarySource, secondarySource], 28, 68) || {
    rgb: hslToRgb({ h: primarySource.hsl.h - 62, s: 0.58, l: 0.62 }),
    hsl: { h: (primarySource.hsl.h + 298) % 360, s: 0.58, l: 0.62 },
    count: 1,
  };

  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const primary = normalizeColor(primarySource.rgb, 0.28, 0.56, 0.72);
  const secondary = normalizeColor(secondarySource.rgb, 0.3, 0.46, 0.64);
  const accent = normalizeColor(accentSource.rgb, 0.38, 0.5, 0.68);
  const surface = mixRgb(dominant.rgb, white, 0.9);
  const inkSeed = mixRgb(accent, black, 0.72);
  const ink = ensureContrast(inkSeed, surface, 7);
  const mutedSeed = mixRgb(hexToRgb(ink), surface, 0.28);
  const muted = ensureContrast(mutedSeed, surface, 4.5);
  const strong = ensureContrast(secondary, white, 4.5);
  const link = ensureContrast(secondary, surface, 4.5);

  return {
    version: 1,
    primary: rgbToHex(primary),
    primarySoft: rgbToHex(mixRgb(primary, white, 0.62)),
    secondary: rgbToHex(secondary),
    secondarySoft: rgbToHex(mixRgb(secondary, white, 0.72)),
    accent: rgbToHex(accent),
    surface: rgbToHex(surface),
    ink,
    muted,
    strong,
    link,
    sourceDominant: rgbToHex(dominant.rgb),
  };
}

function isValidPalette(palette) {
  return Boolean(
    palette &&
    REQUIRED_PALETTE_KEYS.every((key) => HEX_COLOR.test(palette[key] || "")) &&
    contrastRatio(palette.ink, palette.surface) >= 7 &&
    contrastRatio(palette.muted, palette.surface) >= 4.5,
  );
}

function analyzePaletteFromCanvas(sourceCanvas) {
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 72;
  sampleCanvas.height = 72;
  const context = sampleCanvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("当前 Codex 无法分析图片配色");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const pixels = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const palette = buildPaletteFromPixels(pixels);
  if (!isValidPalette(palette)) throw new Error("无法从这张图片生成可读主题配色");
  return palette;
}

async function analyzePaletteFromDataUrl(dataUrl) {
  const image = await decodeImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前 Codex 无法分析图片配色");
  context.drawImage(image, 0, 0);
  return analyzePaletteFromCanvas(canvas);
}

function clearPaletteVariables(root) {
  for (const variable of Object.values(PALETTE_VARIABLES)) {
    root.style.removeProperty(variable);
  }
}

function applyPaletteVariables(root, palette) {
  for (const [key, variable] of Object.entries(PALETTE_VARIABLES)) {
    root.style.setProperty(variable, palette[key]);
  }
}

function removeThemeState() {
  const root = rootElement();
  root.removeAttribute("data-shinobu-theme");
  root.removeAttribute("data-shinobu-motion");
  root.removeAttribute("data-shinobu-artwork");
  root.removeAttribute("data-shinobu-auto-palette");
  root.style.removeProperty("--shinobu-art-image");
  root.style.removeProperty("--shinobu-art-fit");
  root.style.removeProperty("--shinobu-art-position");
  clearPaletteVariables(root);
}

function applyThemeState(api) {
  const root = rootElement();
  const artworkEnabled = api.storage.get("artworkEnabled", true) !== false;
  const autoPaletteEnabled = api.storage.get("autoPaletteEnabled", true) !== false;
  const motionEnabled = api.storage.get("motionEnabled", true) !== false;
  const fit = api.storage.get("artworkFit", "cover") === "contain" ? "contain" : "cover";
  const positionKey = api.storage.get("artworkPosition", "right");
  const position = POSITION_VALUES[positionKey] || POSITION_VALUES.right;

  root.setAttribute("data-shinobu-theme", "active");
  root.setAttribute("data-shinobu-motion", motionEnabled ? "on" : "off");
  root.setAttribute("data-shinobu-artwork", artworkEnabled ? "on" : "off");
  root.setAttribute("data-shinobu-auto-palette", autoPaletteEnabled ? "on" : "off");
  root.style.setProperty("--shinobu-art-fit", fit);
  root.style.setProperty("--shinobu-art-position", position);

  if (!artworkEnabled) {
    root.style.setProperty("--shinobu-art-image", "none");
  } else if (artworkRecord?.dataUrl) {
    root.style.setProperty("--shinobu-art-image", `url("${artworkRecord.dataUrl}")`);
  } else {
    root.style.removeProperty("--shinobu-art-image");
  }

  if (autoPaletteEnabled && isValidPalette(artworkRecord?.palette)) {
    applyPaletteVariables(root, artworkRecord.palette);
  } else {
    clearPaletteVariables(root);
  }
}

async function readArtwork(api) {
  try {
    if (!(await api.fs.exists(ARTWORK_FILE))) return null;
    const parsed = JSON.parse(await api.fs.read(ARTWORK_FILE));
    if (typeof parsed?.dataUrl !== "string" || !parsed.dataUrl.startsWith("data:image/")) {
      return null;
    }
    return {
      dataUrl: parsed.dataUrl,
      name: typeof parsed.name === "string" ? parsed.name : "本地图片",
      palette: isValidPalette(parsed.palette) ? parsed.palette : null,
    };
  } catch (error) {
    api.log.warn("Unable to load local artwork; using bundled artwork", error);
    return null;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function decodeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解码这张图片"));
    image.src = dataUrl;
  });
}

async function prepareArtwork(file) {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    throw new Error("请选择 PNG、JPG 或 WebP 图片");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error("图片不能超过 16 MB");
  }

  const source = await fileToDataUrl(file);
  const image = await decodeImage(source);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前 Codex 无法处理图片画布");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);

  const palette = analyzePaletteFromCanvas(canvas);

  const dataUrl = canvas.toDataURL("image/webp", 0.9);
  if (!dataUrl.startsWith("data:image/")) throw new Error("图片转换失败");
  if (dataUrl.length > 8 * 1024 * 1024) {
    throw new Error("处理后的图片仍然过大，请换一张分辨率更低的图片");
  }
  return { dataUrl, name: file.name, palette };
}

function switchControl(initial, onChange) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "switch");
  const pill = document.createElement("span");
  const knob = document.createElement("span");
  knob.className =
    "rounded-full border border-[color:var(--gray-0)] bg-[color:var(--gray-0)] " +
    "shadow-sm transition-transform duration-200 ease-out h-4 w-4";
  pill.appendChild(knob);

  const apply = (enabled) => {
    button.setAttribute("aria-checked", String(enabled));
    button.className =
      "inline-flex items-center text-sm focus-visible:outline-none focus-visible:ring-2 " +
      "focus-visible:ring-token-focus-border focus-visible:rounded-full cursor-interaction";
    pill.className =
      "relative inline-flex shrink-0 items-center rounded-full transition-colors " +
      "duration-200 ease-out h-5 w-8 " +
      (enabled ? "bg-token-charts-yellow" : "bg-token-foreground/20");
    knob.style.transform = enabled ? "translateX(14px)" : "translateX(2px)";
  };

  let enabled = Boolean(initial);
  apply(enabled);
  button.appendChild(pill);
  button.addEventListener("click", async () => {
    enabled = !enabled;
    apply(enabled);
    await onChange(enabled);
  });
  return button;
}

function settingRow(labelText, descriptionText, control) {
  const row = document.createElement("div");
  row.className = "flex items-center justify-between gap-4 p-3";
  const left = document.createElement("div");
  left.className = "flex min-w-0 flex-col gap-1";
  const label = document.createElement("div");
  label.className = "min-w-0 text-sm text-token-text-primary";
  label.textContent = labelText;
  const description = document.createElement("div");
  description.className = "text-token-text-secondary min-w-0 text-sm";
  description.textContent = descriptionText;
  left.append(label, description);
  row.append(left, control);
  return row;
}

function selectControl(value, options, onChange) {
  const select = document.createElement("select");
  select.className =
    "border-token-border bg-token-foreground/5 hover:bg-token-foreground/10 " +
    "h-token-button-composer min-w-[150px] rounded-md border px-3 text-sm " +
    "text-token-text-primary cursor-interaction";
  for (const option of options) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    element.selected = option.value === value;
    select.appendChild(element);
  }
  select.addEventListener("change", () => onChange(select.value));
  return select;
}

function actionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "border-token-border bg-token-foreground/5 hover:bg-token-foreground/10 " +
    "h-token-button-composer rounded-md border px-3 text-sm text-token-text-primary " +
    "cursor-interaction disabled:cursor-not-allowed disabled:opacity-50";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

async function renderSettings(container, api) {
  container.innerHTML = "";

  const heading = document.createElement("div");
  heading.className = "flex min-w-0 flex-col gap-1 pb-3";
  const title = document.createElement("div");
  title.className = "text-base font-medium text-token-text-primary";
  title.textContent = "小忍主题外观";
  const subtitle = document.createElement("div");
  subtitle.className = "text-token-text-secondary text-sm";
  subtitle.textContent = "柠檬黄、薄荷绿与暖粉配色；原版图片只保存在你的本机。";
  heading.append(title, subtitle);

  const card = document.createElement("div");
  card.className =
    "border-token-border flex flex-col divide-y-[0.5px] divide-token-border rounded-lg border";
  card.style.backgroundColor = "var(--color-background-panel, var(--color-token-bg-fog))";

  const artworkSwitch = switchControl(
    api.storage.get("artworkEnabled", true) !== false,
    async (enabled) => {
      api.storage.set("artworkEnabled", enabled);
      applyThemeState(api);
    },
  );
  card.appendChild(settingRow("显示角色主视觉", "关闭后只保留小忍配色与玻璃面板。", artworkSwitch));

  const palettePreview = document.createElement("div");
  palettePreview.className = "mt-3 flex min-h-8 flex-wrap items-center gap-2";
  const updatePalettePreview = () => {
    palettePreview.replaceChildren();
    const palette = artworkRecord?.palette;
    if (!isValidPalette(palette)) {
      palettePreview.textContent = artworkRecord ? "这张旧图片将在下次载入时自动补算配色。" : "内置插画使用小忍默认配色。";
      palettePreview.className = "text-token-text-secondary mt-3 min-h-8 text-sm";
      return;
    }
    palettePreview.className = "mt-3 flex min-h-8 flex-wrap items-center gap-2";
    for (const [label, key] of [["主色", "primary"], ["辅助", "secondary"], ["强调", "accent"], ["表面", "surface"], ["文字", "ink"]]) {
      const swatch = document.createElement("span");
      swatch.className = "inline-flex items-center gap-1.5 text-xs text-token-text-secondary";
      const color = document.createElement("span");
      color.className = "inline-block h-5 w-5 rounded-full border border-token-border shadow-sm";
      color.style.backgroundColor = palette[key];
      color.title = `${label} ${palette[key]}`;
      const text = document.createElement("span");
      text.textContent = label;
      swatch.append(color, text);
      palettePreview.appendChild(swatch);
    }
  };

  const autoPaletteSwitch = switchControl(
    api.storage.get("autoPaletteEnabled", true) !== false,
    async (enabled) => {
      api.storage.set("autoPaletteEnabled", enabled);
      applyThemeState(api);
      updatePalettePreview();
    },
  );
  card.appendChild(settingRow("根据图片自动配色", "换图后在本机提取主色，并保证正文与表面的对比度。", autoPaletteSwitch));

  const motionSwitch = switchControl(
    api.storage.get("motionEnabled", true) !== false,
    async (enabled) => {
      api.storage.set("motionEnabled", enabled);
      applyThemeState(api);
    },
  );
  card.appendChild(settingRow("轻微动效", "控制甜甜圈漂浮和输入框呼吸光。", motionSwitch));

  const fitSelect = selectControl(
    api.storage.get("artworkFit", "cover"),
    [
      { value: "cover", label: "无缝铺满主界面（推荐）" },
      { value: "contain", label: "完整显示原图（可能出现留白）" },
    ],
    (value) => {
      api.storage.set("artworkFit", value);
      applyThemeState(api);
    },
  );
  card.appendChild(settingRow("图片显示方式", "默认保留完整人物；铺满模式适合自带留白的横版图片。", fitSelect));

  const positionSelect = selectControl(
    api.storage.get("artworkPosition", "right"),
    [
      { value: "right", label: "角色靠右" },
      { value: "center", label: "居中" },
      { value: "left", label: "角色靠左" },
    ],
    (value) => {
      api.storage.set("artworkPosition", value);
      applyThemeState(api);
    },
  );
  card.appendChild(settingRow("图片位置", "根据你选择的原版图片调整构图。", positionSelect));

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png,image/jpeg,image/webp";
  fileInput.hidden = true;
  const chooseButton = actionButton("选择本地图片", () => fileInput.click());
  const status = document.createElement("div");
  status.className = "text-token-text-secondary mt-2 text-sm";
  status.textContent = artworkRecord?.name ? `当前：${artworkRecord.name}` : "当前：内置原创同人插画";

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    chooseButton.disabled = true;
    status.textContent = "正在处理图片…";
    try {
      artworkRecord = await prepareArtwork(file);
      await api.fs.write(ARTWORK_FILE, JSON.stringify(artworkRecord));
      api.storage.set("artworkEnabled", true);
      applyThemeState(api);
      status.textContent = `当前：${artworkRecord.name}（仅保存在本机）`;
      updatePalettePreview();
      api.log.info("Local artwork updated", artworkRecord.name);
    } catch (error) {
      status.textContent = `导入失败：${error.message}`;
      api.log.error("Local artwork import failed", error);
    } finally {
      chooseButton.disabled = false;
      fileInput.value = "";
    }
  });

  const imageControls = document.createElement("div");
  imageControls.className = "flex shrink-0 items-center gap-2";
  imageControls.append(chooseButton, fileInput);
  card.appendChild(settingRow("自定义 / 原版图片", "支持 PNG、JPG、WebP，最大 16 MB。", imageControls));

  const resetButton = actionButton("恢复内置插画", async () => {
    resetButton.disabled = true;
    try {
      artworkRecord = null;
      await api.fs.write(ARTWORK_FILE, "{}");
      applyThemeState(api);
      status.textContent = "当前：内置原创同人插画";
      updatePalettePreview();
    } finally {
      resetButton.disabled = false;
    }
  });
  card.appendChild(settingRow("重置图片", "不会改动你电脑中的原始图片文件。", resetButton));

  updatePalettePreview();
  container.append(heading, card, status, palettePreview);
}

module.exports = {
  async start(api) {
    if (api.process !== "renderer") return;
    if (isAuxiliaryRendererWindow()) {
      api.log.info("Shinobu theme skipped in auxiliary renderer");
      return;
    }
    activeApi = api;
    if (Number(api.storage.get("layoutVersion", 0)) < 3) {
      api.storage.set("artworkFit", "cover");
      api.storage.set("artworkPosition", "right");
      api.storage.set("layoutVersion", 3);
    }
    styleElement?.remove();
    styleElement = document.createElement("style");
    styleElement.id = STYLE_ID;
    styleElement.dataset.tweak = api.manifest.id;
    styleElement.textContent = CSS_TEXT;
    document.head.appendChild(styleElement);
    artworkRecord = await readArtwork(api);
    if (artworkRecord?.dataUrl && !isValidPalette(artworkRecord.palette)) {
      try {
        artworkRecord.palette = await analyzePaletteFromDataUrl(artworkRecord.dataUrl);
        await api.fs.write(ARTWORK_FILE, JSON.stringify(artworkRecord));
        api.log.info("Palette generated for existing local artwork");
      } catch (error) {
        api.log.warn("Unable to generate palette for existing local artwork", error);
      }
    }
    applyThemeState(api);
    startLayoutTracking();

    api.settings?.registerPage({
      id: "appearance",
      title: "小忍主题",
      description: "主题配色、动效和本地原版图片。",
      iconSvg:
        '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">' +
        '<circle cx="10" cy="10" r="6" stroke="currentColor" stroke-width="3"/>' +
        '<circle cx="10" cy="10" r="1.5" fill="currentColor"/></svg>',
      render(container) {
        void renderSettings(container, api);
      },
    });
    api.log.info("Shinobu theme started");
  },

  stop() {
    styleElement?.remove();
    styleElement = null;
    stopLayoutTracking();
    removeThemeState();
    activeApi?.log.info("Shinobu theme stopped");
    activeApi = null;
    artworkRecord = null;
  },

  __test: {
    buildPaletteFromPixels,
    contrastRatio,
    isValidPalette,
    calculateReadingRail,
  },
};
