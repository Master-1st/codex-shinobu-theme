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

let styleElement = null;
let activeApi = null;
let artworkRecord = null;

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

function removeThemeState() {
  const root = rootElement();
  root.removeAttribute("data-shinobu-theme");
  root.removeAttribute("data-shinobu-motion");
  root.removeAttribute("data-shinobu-artwork");
  root.style.removeProperty("--shinobu-art-image");
  root.style.removeProperty("--shinobu-art-fit");
  root.style.removeProperty("--shinobu-art-position");
}

function applyThemeState(api) {
  const root = rootElement();
  const artworkEnabled = api.storage.get("artworkEnabled", true) !== false;
  const motionEnabled = api.storage.get("motionEnabled", true) !== false;
  const fit = api.storage.get("artworkFit", "cover") === "contain" ? "contain" : "cover";
  const positionKey = api.storage.get("artworkPosition", "right");
  const position = POSITION_VALUES[positionKey] || POSITION_VALUES.right;

  root.setAttribute("data-shinobu-theme", "active");
  root.setAttribute("data-shinobu-motion", motionEnabled ? "on" : "off");
  root.setAttribute("data-shinobu-artwork", artworkEnabled ? "on" : "off");
  root.style.setProperty("--shinobu-art-fit", fit);
  root.style.setProperty("--shinobu-art-position", position);

  if (!artworkEnabled) {
    root.style.setProperty("--shinobu-art-image", "none");
  } else if (artworkRecord?.dataUrl) {
    root.style.setProperty("--shinobu-art-image", `url("${artworkRecord.dataUrl}")`);
  } else {
    root.style.removeProperty("--shinobu-art-image");
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

  const dataUrl = canvas.toDataURL("image/webp", 0.9);
  if (!dataUrl.startsWith("data:image/")) throw new Error("图片转换失败");
  if (dataUrl.length > 8 * 1024 * 1024) {
    throw new Error("处理后的图片仍然过大，请换一张分辨率更低的图片");
  }
  return { dataUrl, name: file.name };
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
      { value: "cover", label: "铺满主界面背景（推荐）" },
      { value: "contain", label: "完整显示" },
    ],
    (value) => {
      api.storage.set("artworkFit", value);
      applyThemeState(api);
    },
  );
  card.appendChild(settingRow("图片显示方式", "默认铺满主界面背景；完整显示会保留图片全部边缘。", fitSelect));

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
    } finally {
      resetButton.disabled = false;
    }
  });
  card.appendChild(settingRow("重置图片", "不会改动你电脑中的原始图片文件。", resetButton));

  container.append(heading, card, status);
}

module.exports = {
  async start(api) {
    if (api.process !== "renderer") return;
    if (isAuxiliaryRendererWindow()) {
      api.log.info("Shinobu theme skipped in auxiliary renderer");
      return;
    }
    activeApi = api;
    styleElement?.remove();
    styleElement = document.createElement("style");
    styleElement.id = STYLE_ID;
    styleElement.dataset.tweak = api.manifest.id;
    styleElement.textContent = CSS_TEXT;
    document.head.appendChild(styleElement);
    artworkRecord = await readArtwork(api);
    applyThemeState(api);

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
    removeThemeState();
    activeApi?.log.info("Shinobu theme stopped");
    activeApi = null;
    artworkRecord = null;
  },
};
