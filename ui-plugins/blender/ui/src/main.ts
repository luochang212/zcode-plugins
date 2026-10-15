// 面板入口：装配 store、DOM、viewer、宿主事件与轮询。业务状态全部在 panelState.ts 的 reducer 里。
import { getAlias, PanelApi } from "./api";
import {
  $,
  applyStaticMessages,
  mountIcons,
  renderEmpty,
  renderHeader,
  renderRenderTab,
  renderToolbar,
} from "./chrome";
import { fill, messagesFor, type Messages } from "./i18n";
import {
  base64ToArrayBuffer,
  followUpPrompt,
  initialState,
  modelContextOf,
  needsGlb,
  reduce,
  revisionChangeSummary,
  selectionSummary,
  renderPreviewArgs,
  widgetStateOf,
  type CameraPose,
  type PanelAction,
  type PanelState,
} from "./panelState";
import { neighbourName, renderProps, renderTree } from "./tree";
import { createViewer, type Viewer } from "./viewer";

const POLL_MS = 5000;
const INLINE_HEIGHT = 520;
const TOAST_MS = 2500;

function boot(api: PanelApi) {
  let state: PanelState = initialState;
  let t: Messages = messagesFor(api.locale);
  let viewer: Viewer | null = null;
  let loadSeq = 0;
  let lastWidgetJson = "";
  // 一次性提示（"已发送到对话"等）是纯界面瞬态，不进 reducer。
  let toastText = "";
  let toastTimer = 0;
  let appliedStyleKeys: string[] = [];

  function dispatch(action: PanelAction) {
    const prev = state;
    state = reduce(state, action);
    if (state !== prev) render(prev);
  }

  // ---- 投影：widgetState / 高度 ----
  // widgetState 只是宿主内存里的界面状态（同一会话内关掉再打开面板可恢复），模型看不到。
  function syncWidgetState() {
    const json = JSON.stringify(widgetStateOf(state));
    if (json === lastWidgetJson) return;
    lastWidgetJson = json;
    void api.setWidgetState(widgetStateOf(state));
  }
  // ---- 模型上下文（4a-0）：宿主不再把 widgetState 喂给模型，用户动作（开文件 / 选中 / 视角 / 引擎 / 刷新发现 revision 变化）
  // 后经 updateModelContext 汇报；同一面板实例的后续汇报替换前一份 chip，所以每次都带完整的 modelContextOf(state)。
  function reportModelContext(text: string) {
    void api.updateModelContext(text, modelContextOf(state));
  }
  /** 宿主样式变量写到 :root；宿主不再给的键要删掉，否则换主题后残留旧值。 */
  function applyHostStyles() {
    const vars = api.styleVariables;
    const root = document.documentElement.style;
    for (const key of appliedStyleKeys) if (!(key in vars)) root.removeProperty(key);
    for (const [key, value] of Object.entries(vars)) root.setProperty(key, value);
    appliedStyleKeys = Object.keys(vars);
  }
  function reportHeight() {
    const fullscreen = api.displayMode === "fullscreen";
    document.body.classList.toggle("fullscreen", fullscreen);
    if (!fullscreen) api.notifyHeight(INLINE_HEIGHT);
    viewer?.resize();
  }

  // ---- 数据流 ----
  async function callTool(name: string, args: Record<string, unknown> = {}) {
    try {
      const output = await api.call(name, args);
      dispatch({ type: "tool-result", output });
      return output as Record<string, unknown> | null;
    } catch (error) {
      dispatch({
        type: "fail",
        message: `${name}: ${error instanceof Error ? error.message : String(error)}`,
      });
      return null;
    }
  }

  /** inspect → 若 revision 变了或没有 GLB → export_glb → readResource → viewer。序号守卫丢弃迟到结果。 */
  async function refresh({ force = false, announce = false } = {}) {
    const before = state.revision;
    if (force) dispatch({ type: "invalidate-glb" });
    await callTool("inspect_scene");
    if (announce && before !== null && state.revision !== before)
      reportModelContext(revisionChangeSummary(before, state.revision));
    await ensureGlb();
  }
  async function ensureGlb() {
    if (!needsGlb(state)) return;
    if (!viewer || !api.canReadResource) return;
    const seq = ++loadSeq;
    dispatch({ type: "busy", key: "exporting", on: true });
    try {
      const output = await callTool("export_glb", {});
      const uri = (output?.glb as { uri?: string } | undefined)?.uri;
      if (!uri || seq !== loadSeq) return;
      const resource = await api.readResource(uri);
      if (seq !== loadSeq) return;
      if (!resource || !("blob" in resource) || !resource.blob)
        throw new Error(`empty resource ${resource?.mimeType ?? ""}`);
      const names = await viewer.loadGlb(base64ToArrayBuffer(resource.blob));
      if (seq !== loadSeq) return;
      viewer.setKnownNames(state.scene?.objects.map((o) => o.name) ?? names);
      dispatch({ type: "glb-loaded", uri });
      viewer.setSelected(state.selected);
      if (state.cameraPose) viewer.setCameraPose(state.cameraPose);
    } catch (error) {
      dispatch({
        type: "fail",
        message: `${t.loadFailed}: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      // 只有最新一轮能收起浮层；被新一轮取代的旧请求不动它。
      if (seq === loadSeq) dispatch({ type: "busy", key: "exporting", on: false });
    }
  }
  async function loadRenderImage() {
    const render = state.render;
    if (!render || state.renderImage || !api.canReadResource) return;
    const resource = await api.readResource(render.uri).catch(() => null);
    if (resource && "blob" in resource && resource.blob)
      dispatch({
        type: "render-image",
        uri: render.uri,
        dataUrl: `data:${resource.mimeType || "image/png"};base64,${resource.blob}`,
      });
  }

  // ---- 用户动作 ----
  function select(name: string | null, fromUser: boolean) {
    dispatch({ type: "select", name });
    // 取消选中也要告诉模型，否则它还以为上次选中的物体是"这个"。
    if (fromUser) reportModelContext(selectionSummary(state));
  }
  async function openFile(path: string) {
    const output = await callTool("open_scene", { path });
    if (output && !output.error) {
      reportModelContext(`Blender 面板：用户打开了 ${state.file}（revision ${state.revision}）。`);
      await ensureGlb();
    }
  }
  /** 双击 / 聚焦按钮：选中（已选中不反选）并把相机对准它。 */
  function focusObject(name: string) {
    if (state.selected !== name) select(name, true);
    if (viewer?.frameObject(name)) commitCamera(viewer.getCameraPose());
  }
  function commitCamera(pose: CameraPose) {
    dispatch({ type: "camera", pose });
    reportModelContext(`Blender 面板：用户调整了预览视角，cameraPose 见结构化内容。`);
  }
  async function renderPreview() {
    if (state.busy.rendering) return;
    dispatch({ type: "busy", key: "rendering", on: true });
    try {
      await callTool("render_preview", renderPreviewArgs(state.renderEngine));
    } finally {
      dispatch({ type: "busy", key: "rendering", on: false });
    }
    if (state.render && !state.error) dispatch({ type: "tab", tab: "render" });
  }
  function renderPrompts() {
    for (const kind of ["lighting", "camera"] as const)
      $(`${kind}-prompt`).textContent = followUpPrompt(kind, state, api.locale);
  }
  function toggleUseCases(open: boolean) {
    $("use-case-menu").hidden = !open;
    $("btn-use-cases").setAttribute("aria-expanded", String(open));
    if (open) renderPrompts();
  }
  async function copyPrompt(kind: "lighting" | "camera") {
    const text = $(`${kind}-prompt`).textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      toast(t.copied);
    } catch {
      // iframe 未获得 Clipboard API 权限时，保留用户手势内的传统复制路径。
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.append(area);
      area.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        /* 失败时允许手动选择。 */
      }
      area.remove();
      document.querySelector<HTMLButtonElement>(`.copy-prompt[data-kind="${kind}"]`)?.focus();
      toast(copied ? t.copied : t.copyFailed);
    }
  }
  function showInspector(panel: string) {
    for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-inspector]")) {
      const selected = tab.dataset.inspector === panel;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(`${tab.dataset.inspector}-panel`).hidden = !selected;
    }
  }
  function toast(text: string) {
    toastText = text;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastText = "";
      renderBanner();
    }, TOAST_MS);
    renderBanner();
  }
  function renderBanner() {
    const text = state.error ?? toastText;
    const banner = $("banner");
    banner.hidden = !text;
    banner.classList.toggle("error", !!state.error);
    $("banner-text").textContent = text;
    $("banner-close").hidden = !state.error;
  }

  // ---- 渲染 ----
  function render(prev: PanelState) {
    document.documentElement.dataset.theme = api.theme;
    const empty = state.phase !== "ready";
    $("empty").hidden = !empty;
    $("workspace").hidden = empty;
    renderHeader(state, t);
    renderPrompts();
    renderToolbar(state, t);
    renderBanner();
    $("scene-tab").hidden = state.tab !== "scene";
    $("render-tab").hidden = state.tab !== "render";
    if (empty) renderEmpty(state, t, (file) => void openFile(file));
    if (prev.scene !== state.scene || prev.selected !== state.selected || prev === state) {
      $("tree-title").textContent = fill(t.objectsCount, { n: state.scene?.objects.length ?? 0 });
      renderTree($("tree"), state, t, (name) => select(name, true));
      renderProps($("props"), state, t);
      viewer?.setKnownNames(state.scene?.objects.map((o) => o.name) ?? []);
    }
    if (prev.selected !== state.selected) viewer?.setSelected(state.selected);
    if (renderRenderTab(state, t)) void loadRenderImage();
    if (prev.tab !== state.tab) viewer?.resize();
    syncWidgetState();
  }

  // ---- 静态文案与事件 ----
  function applyMessages() {
    t = messagesFor(api.locale);
    applyStaticMessages(t, api.canReadResource);
  }
  mountIcons();
  applyMessages();
  for (const tab of document.querySelectorAll<HTMLElement>("[data-tab]")) {
    tab.addEventListener("click", () =>
      dispatch({ type: "tab", tab: tab.dataset.tab === "render" ? "render" : "scene" }),
    );
  }
  $("btn-refresh").addEventListener("click", () => void refresh({ force: true, announce: true }));
  $("btn-render").addEventListener("click", () => void renderPreview());
  $("btn-render-empty").addEventListener("click", () => void renderPreview());
  $("banner-close").addEventListener("click", () => dispatch({ type: "dismiss-error" }));
  $<HTMLSelectElement>("render-engine").addEventListener("change", (event) => {
    const value = (event.target as HTMLSelectElement).value;
    const engine = value === "cycles" ? "cycles" : "eevee";
    dispatch({ type: "render-engine", engine });
    // 用户主动改了渲染引擎：告诉模型，之后它调 render_preview 时照用（renderEngine 也在结构化内容里）。
    reportModelContext(
      `Blender 面板：用户把渲染引擎切到 ${engine === "cycles" ? "Cycles（高质量）" : "EEVEE（快速）"}，之后 render_preview 请传 engine: "${engine}"。`,
    );
  });
  $("btn-use-cases").addEventListener("click", () => toggleUseCases(!!$("use-case-menu").hidden));
  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && !$("btn-use-cases").parentElement?.contains(event.target))
      toggleUseCases(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("use-case-menu").hidden) {
      toggleUseCases(false);
      $("btn-use-cases").focus();
    }
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>(".copy-prompt"))
    button.addEventListener(
      "click",
      () => void copyPrompt(button.dataset.kind === "camera" ? "camera" : "lighting"),
    );
  for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-inspector]")) {
    tab.addEventListener("click", () => showInspector(tab.dataset.inspector!));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? "objects"
          : event.key === "End"
            ? "properties"
            : tab.dataset.inspector === "objects"
              ? "properties"
              : "objects";
      showInspector(next);
      $(`tab-${next}`).focus();
    });
  }
  $("btn-fit").addEventListener("click", () => {
    if (viewer?.frameAll()) commitCamera(viewer.getCameraPose());
  });
  $("btn-focus").addEventListener("click", () => {
    if (state.selected) focusObject(state.selected);
  });
  // 对象树键盘：↑/↓ 移动选中，Enter 聚焦，Esc 取消选中。
  $("tree").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = neighbourName(state, event.key === "ArrowDown" ? 1 : -1);
      if (next && next !== state.selected) select(next, true);
    } else if (event.key === "Enter" && state.selected) {
      event.preventDefault();
      focusObject(state.selected);
    } else if (event.key === "Escape" && state.selected) {
      event.preventDefault();
      select(null, true);
    }
  });

  viewer = createViewer($("viewer"), {
    // 点空白处取消选中；点已选中的物体保持选中（reducer 的同名反选只给列表用）。
    onSelect: (name) => {
      if (name !== state.selected) select(name, true);
    },
    onFocus: (name) => focusObject(name),
    // 拖拽视角只在放手时汇报一次，不在拖动过程中刷模型上下文。
    onCameraEnd: (pose) => commitCamera(pose),
  });
  viewer.setTheme(api.theme);

  // 宿主事件：toolOutput 变化（本卡片结果或 R4 路由来的 surface 结果）、主题/locale/displayMode 变化。
  let lastOutput: unknown = undefined;
  function onGlobals() {
    applyHostStyles();
    viewer?.setTheme(api.theme);
    applyMessages();
    reportHeight();
    if (api.toolOutput !== lastOutput) {
      lastOutput = api.toolOutput;
      dispatch({ type: "tool-result", output: api.toolOutput });
      void ensureGlb();
    }
    render(state);
  }
  api.onGlobals(onGlobals);

  // 启动：恢复 widgetState → 首个 toolOutput → 探测引擎 + 列文件 → 有文件线索就 inspect。
  dispatch({ type: "hydrate", widgetState: api.widgetState });
  lastOutput = api.toolOutput;
  dispatch({ type: "tool-result", output: api.toolOutput });
  applyHostStyles();
  render(initialState);
  reportHeight();
  void (async () => {
    await Promise.all([
      callTool("ensure_engine", { download: false }),
      callTool("pick_scene_file", {}),
    ]);
    if (state.tier !== "gltf-only" && (state.phase === "ready" || state.file)) await refresh();
  })();

  // e2e 钩子：桌面 e2e 只能经 main 进程在插件 frame 里 executeJavaScript，读 reducer 状态比轮询瞬态 DOM 稳。
  (window as unknown as { __blenderPanel?: unknown }).__blenderPanel = {
    state: () => state,
    refresh: () => refresh({ force: true }),
  };

  // 兜底轮询：面板可见且场景就绪时每 5 s 比对 revision。
  window.setInterval(() => {
    if (
      document.visibilityState !== "visible" ||
      state.phase !== "ready" ||
      state.tier === "gltf-only"
    )
      return;
    void refresh();
  }, POLL_MS);
}

const alias = getAlias();
if (!alias) {
  document.getElementById("banner")!.hidden = false;
  document.getElementById("banner-text")!.textContent =
    "MCP Apps 宿主不可用：请在 ZCode 桌面端的插件沙箱里打开。";
} else {
  boot(new PanelApi(alias));
}
