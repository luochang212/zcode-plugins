// 面板外壳的 DOM 投影：头部、工具条状态、空态、渲染页。纯函数，输入 PanelState，输出到固定 id 的节点。
import { fill, type Messages } from "./i18n";
import { icon, type IconName } from "./icons";
import { renderIsStale, splitPath, type PanelState } from "./panelState";

export const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;

/** 模板里带 data-icon 的按钮在启动时补上图标（只做一次）。 */
export function mountIcons(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-icon]")) {
    if (node.querySelector("svg")) continue;
    node.prepend(icon(node.dataset.icon as IconName));
  }
}

/** 按钮只有图标时，把文案放到 title 与 aria-label。 */
function label(id: string, text: string) {
  const node = $(id);
  node.title = text;
  node.setAttribute("aria-label", text);
}

export function applyStaticMessages(t: Messages, canReadResource: boolean): void {
  const text: Record<string, string> = {
    "empty-title": t.emptyTitle,
    "empty-hint": t.emptyHint,
    "files-title": t.filesTitle,
    "tab-scene": t.tabScene,
    "tab-render": t.tabRender,
    "btn-render-label": t.render,
    "btn-render-empty-label": t.renderNow,
    "engine-eevee": t.engineFast,
    "engine-cycles": t.engineHigh,
    "lighting-title": t.lighting,
    "camera-title": t.cameraPose,
    "use-cases-label": t.useCases,
    "tab-objects": t.objects,
    "tab-properties": t.properties,
    "render-empty-text": t.noRender,
  };
  for (const [id, value] of Object.entries(text)) $(id).textContent = value;
  $("render-engine").title = t.renderEngineHint;
  for (const button of document.querySelectorAll<HTMLElement>(".copy-prompt")) {
    button.title = t.copyPrompt;
    button.setAttribute("aria-label", t.copyPrompt);
  }
  label("btn-refresh", t.refresh);
  label("btn-fit", t.fitAll);
  label("btn-focus", t.focusSelected);
  label("banner-close", t.dismiss);
  $("viewer-note").textContent = canReadResource ? t.viewerHint : t.noReadResource;
}

export function renderHeader(state: PanelState, t: Messages): void {
  const file = state.file ? splitPath(state.file) : null;
  $("file-name").textContent = file?.name ?? "";
  $("file-name").title = state.file ?? "";
  const revision = $("revision");
  revision.hidden = state.revision === null || !state.file;
  revision.textContent = `r${state.revision ?? "?"}`;
  revision.title = `${t.revision} ${state.revision ?? "?"}`;


}

/** 工具条：标签页、忙碌态、主按钮可用性。 */
export function renderToolbar(state: PanelState, t: Messages): void {
  for (const tab of document.querySelectorAll<HTMLElement>("[data-tab]"))
    tab.setAttribute("aria-selected", String(tab.dataset.tab === state.tab));
  $<HTMLSelectElement>("render-engine").value = state.renderEngine;
  const ready = state.phase === "ready" && state.tier !== "gltf-only";
  const rendering = state.busy.rendering;
  for (const id of ["btn-render", "btn-render-empty"]) {
    const button = $<HTMLButtonElement>(id);
    button.disabled = !ready || rendering;
  }
  $("btn-render-label").textContent = rendering ? `${t.render}…` : t.render;
  $<HTMLButtonElement>("btn-refresh").disabled = !ready;
  $("btn-refresh").classList.toggle("spin", state.busy.exporting);
  $<HTMLButtonElement>("btn-focus").disabled = !state.selected;

  const busyText = rendering
    ? state.renderEngine === "cycles"
      ? t.renderingCycles
      : t.rendering
    : "";
  $("viewer-busy").hidden = !state.busy.exporting;
  $("viewer-busy").textContent = t.loadingGlb;
  $("render-busy").hidden = !rendering;
  $("render-busy").textContent = busyText;
}

export function renderEmpty(state: PanelState, t: Messages, onOpen: (file: string) => void): void {
  const engineHint = $("engine-hint");
  engineHint.hidden = state.tier !== "gltf-only";
  engineHint.textContent = t.engineMissingHint;

  const list = $("files");
  list.replaceChildren();
  const note = (text: string) =>
    list.append(
      Object.assign(document.createElement("div"), { className: "files-note", textContent: text }),
    );
  $("files-title").hidden = !state.filesLoaded || state.files.length === 0;
  if (!state.filesLoaded) return note(t.scanning);
  if (state.files.length === 0) return note(t.noFiles);
  for (const file of state.files) {
    const { name, dir } = splitPath(file);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-row";
    button.dataset.file = file;
    button.title = file;
    const labelNode = document.createElement("span");
    labelNode.className = "file-label";
    labelNode.append(
      Object.assign(document.createElement("span"), { textContent: name }),
      Object.assign(document.createElement("span"), {
        className: "file-dir",
        textContent: dir || t.workspaceRoot,
      }),
    );
    button.append(icon("file"), labelNode);
    button.addEventListener("click", () => onOpen(file));
    list.append(button);
  }
  if (state.filesTruncated) note(t.truncated);
}

/** 渲染页；图片还没读回来时返回 true，调用方去 readResource。 */
export function renderRenderTab(state: PanelState, t: Messages): boolean {
  const img = $<HTMLImageElement>("render-image");
  const meta = $("render-meta");
  const stale = $("render-stale");
  const empty = !state.render;
  $("render-empty").hidden = !empty || state.busy.rendering;
  if (!state.render) {
    img.hidden = true;
    meta.textContent = "";
    stale.hidden = true;
    return false;
  }
  const r = state.render;
  meta.textContent = `${r.width ?? "?"}×${r.height ?? "?"} · ${t.renderBy} ${r.engineUsed ?? "?"} · r${r.revision ?? "?"}`;
  stale.hidden = !renderIsStale(state);
  stale.textContent = fill(t.staleRender, { current: state.revision ?? "?" });
  if (state.renderImage) {
    if (img.src !== state.renderImage) img.src = state.renderImage;
    img.hidden = false;
    return false;
  }
  img.hidden = true;
  return true;
}
