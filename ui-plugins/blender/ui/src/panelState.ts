// 面板唯一数据源：PanelState 与纯 reducer。DOM、Three.js、widgetState 都是它的投影。
// 工具结果只看 structuredContent 的形状（scene / glb / render / engine / files / error / state），不依赖工具名，
// 这样本卡片的结果、宿主 R4 路由过来的其他工具结果、面板自己 callTool 的结果走同一条路。

export type Tab = "scene" | "render";
/** 面板上用户选的渲染引擎：eevee 快、cycles 高质量（CPU，慢）。写进 widgetState，模型渲染时照用。 */
export type RenderEngine = "eevee" | "cycles";
export const RENDER_ENGINES: readonly RenderEngine[] = ["eevee", "cycles"];
/** 面板"渲染"按钮传给 render_preview 的参数；Cycles 采样给高一点，否则噪点太多看不出质量差别。 */
export function renderPreviewArgs(engine: RenderEngine): {
  engine: RenderEngine;
  samples?: number;
} {
  return engine === "cycles" ? { engine, samples: 128 } : { engine };
}
export type Vec3 = [number, number, number];
export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export interface SceneObject {
  name: string;
  type: string;
  parent?: string | null;
  hidden?: boolean;
  hideRender?: boolean;
  location?: number[];
  rotation?: number[];
  scale?: number[];
  dimensions?: number[];
  materials?: string[];
  vertices?: number;
  faces?: number;
  light?: { type: string; energy: number; color: number[] };
  camera?: { lens: number; active: boolean };
}
export interface MaterialSummary {
  name: string;
  baseColor?: number[] | null;
  metallic?: number;
  roughness?: number;
}
export interface SceneSummary {
  file: string | null;
  sceneName?: string;
  objects: SceneObject[];
  materials: MaterialSummary[];
  cameras?: string[];
  activeCamera: string | null;
  lights?: string[];
  render?: { engine: string; resolution?: number[]; frame?: number };
  counts?: { objects: number; meshes?: number };
  blender?: string;
}
export interface BridgeState {
  file: string | null;
  revision: number;
  selected?: string[];
  camera?: unknown;
  engine?: { render: string; version: string } | null;
}
export interface EngineInfo {
  kind: string;
  path: string | null;
  version: string | null;
  reason: string | null;
}
export interface RenderInfo {
  id?: string;
  uri: string;
  width?: number;
  height?: number;
  revision?: number | null;
  engineUsed?: string;
}
export interface WidgetState {
  file: string | null;
  selected: string[];
  cameraPose: CameraPose | null;
  tab: Tab;
  renderEngine: RenderEngine;
}

export interface PanelState {
  phase: "empty" | "ready";
  engine: EngineInfo | null;
  tier: "full" | "gltf-only" | null;
  file: string | null;
  revision: number | null;
  scene: SceneSummary | null;
  selected: string | null;
  tab: Tab;
  renderEngine: RenderEngine;
  files: string[];
  filesTruncated: boolean;
  /** pick_scene_file 至少返回过一次；之前空列表表示"还在扫描"，不是"没有文件"。 */
  filesLoaded: boolean;
  /** 面板自己发起的长操作；用于禁用按钮与显示进度浮层，防止重复发起。 */
  busy: { exporting: boolean; rendering: boolean };
  render: RenderInfo | null;
  renderImage: string | null;
  glb: { uri: string; revision: number | null; loaded: boolean } | null;
  cameraPose: CameraPose | null;
  error: string | null;
}

export type PanelAction =
  | { type: "hydrate"; widgetState: unknown }
  | { type: "tool-result"; output: unknown }
  | { type: "select"; name: string | null }
  | { type: "tab"; tab: Tab }
  | { type: "render-engine"; engine: RenderEngine }
  | { type: "camera"; pose: CameraPose }
  | { type: "glb-loaded"; uri: string }
  | { type: "invalidate-glb" }
  | { type: "render-image"; uri: string; dataUrl: string }
  | { type: "busy"; key: "exporting" | "rendering"; on: boolean }
  | { type: "dismiss-error" }
  | { type: "fail"; message: string };

export const initialState: PanelState = {
  phase: "empty",
  engine: null,
  tier: null,
  file: null,
  revision: null,
  scene: null,
  selected: null,
  tab: "scene",
  renderEngine: "eevee",
  files: [],
  filesTruncated: false,
  filesLoaded: false,
  busy: { exporting: false, rendering: false },
  render: null,
  renderImage: null,
  glb: null,
  cameraPose: null,
  error: null,
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const isPose = (v: unknown): v is CameraPose => isRec(v) && isVec3(v.position) && isVec3(v.target);

export function parseWidgetState(raw: unknown): Partial<WidgetState> {
  if (!isRec(raw)) return {};
  const out: Partial<WidgetState> = {};
  if (typeof raw.file === "string") out.file = raw.file;
  if (Array.isArray(raw.selected))
    out.selected = raw.selected.filter((s): s is string => typeof s === "string");
  else if (typeof raw.selected === "string") out.selected = [raw.selected];
  if (isPose(raw.cameraPose)) out.cameraPose = raw.cameraPose;
  if (raw.tab === "scene" || raw.tab === "render") out.tab = raw.tab;
  if (raw.renderEngine === "eevee" || raw.renderEngine === "cycles")
    out.renderEngine = raw.renderEngine;
  return out;
}

function applyToolOutput(state: PanelState, output: Rec): PanelState {
  let next: PanelState = { ...state, error: null };
  if (isRec(output.error)) {
    const code = String(output.error.code ?? "error");
    next.error = `[${code}] ${String(output.error.message ?? "")}`.trim();
    if (code === "engine_missing") next.tier = "gltf-only";
  }
  if (isRec(output.state) && typeof output.state.revision === "number") {
    const bridge = output.state as unknown as BridgeState;
    const file = bridge.file === null || typeof bridge.file === "string" ? bridge.file : next.file;
    if (file !== next.file && next.phase === "ready") {
      // 换了文件：场景派生物全部作废，等新的 inspect / export 结果
      next = { ...next, scene: null, selected: null, glb: null, render: null, renderImage: null };
    }
    // 后台重置后的 file:null 是权威状态，不能把默认 Cube 继续标成之前保存的工程。
    next.file = file;
    next.revision = bridge.revision;
  }
  if (isRec(output.engine) && typeof output.engine.kind === "string") {
    const e = output.engine;
    next.engine = {
      kind: String(e.kind),
      path: typeof e.path === "string" ? e.path : null,
      version: typeof e.version === "string" ? e.version : null,
      reason: typeof e.reason === "string" ? e.reason : null,
    };
    if (output.tier === "full" || output.tier === "gltf-only") next.tier = output.tier;
  }
  if (Array.isArray(output.files)) {
    next.files = output.files.filter((f): f is string => typeof f === "string");
    next.filesTruncated = output.truncated === true;
    next.filesLoaded = true;
  }
  if (isRec(output.scene) && Array.isArray(output.scene.objects)) {
    const scene = output.scene as unknown as SceneSummary;
    if (scene.file !== undefined && scene.file !== next.file) {
      next = { ...next, glb: null, render: null, renderImage: null, selected: null };
    }
    next.scene = scene;
    if (scene.file !== undefined) next.file = scene.file;
    next.phase = "ready";
    if (next.selected && !scene.objects.some((o) => o.name === next.selected)) next.selected = null;
  }
  if (isRec(output.render) && typeof output.render.uri === "string") {
    next.render = output.render as unknown as RenderInfo;
    next.renderImage = null;
  }
  if (isRec(output.glb) && typeof output.glb.uri === "string") {
    next.glb = { uri: output.glb.uri, revision: next.revision, loaded: false };
  }
  return next;
}

export function reduce(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "hydrate": {
      const w = parseWidgetState(action.widgetState);
      return {
        ...state,
        file: state.file ?? w.file ?? null,
        selected: w.selected?.[0] ?? state.selected,
        cameraPose: w.cameraPose ?? state.cameraPose,
        tab: w.tab ?? state.tab,
        renderEngine: w.renderEngine ?? state.renderEngine,
      };
    }
    case "tool-result":
      return isRec(action.output) ? applyToolOutput(state, action.output) : state;
    case "select":
      return { ...state, selected: action.name === state.selected ? null : action.name };
    case "tab":
      return { ...state, tab: action.tab };
    case "render-engine":
      return { ...state, renderEngine: action.engine };
    case "camera":
      return { ...state, cameraPose: action.pose };
    case "glb-loaded":
      return state.glb && state.glb.uri === action.uri
        ? { ...state, glb: { ...state.glb, loaded: true } }
        : state;
    case "invalidate-glb":
      return { ...state, glb: null };
    case "render-image":
      return state.render && state.render.uri === action.uri
        ? { ...state, renderImage: action.dataUrl }
        : state;
    case "busy":
      return state.busy[action.key] === action.on
        ? state
        : { ...state, busy: { ...state.busy, [action.key]: action.on } };
    case "dismiss-error":
      return state.error === null ? state : { ...state, error: null };
    case "fail":
      return { ...state, error: action.message };
    default:
      return state;
  }
}

/** 需要（重新）导出 GLB：场景就绪且 GLB 缺失或落后于当前 revision。已请求未加载完的不重复请求。 */
export function needsGlb(state: PanelState): boolean {
  return (
    state.phase === "ready" &&
    !!state.file &&
    (state.glb === null || state.glb.revision !== state.revision)
  );
}

export function widgetStateOf(state: PanelState): WidgetState {
  return {
    file: state.file,
    selected: state.selected ? [state.selected] : [],
    cameraPose: state.cameraPose,
    tab: state.tab,
    renderEngine: state.renderEngine,
  };
}

/** 面板给模型的结构化内容（4a-0：宿主不再把 widgetState 喂给模型，用户动作后经 updateModelContext 汇报）；tab 是纯界面状态，不给模型。 */
export interface ModelContext {
  file: string | null;
  revision: number | null;
  selected: string[];
  cameraPose: CameraPose | null;
  renderEngine: RenderEngine;
}

export function modelContextOf(state: PanelState): ModelContext {
  return {
    file: state.file,
    revision: state.revision,
    selected: state.selected ? [state.selected] : [],
    cameraPose: state.cameraPose,
    renderEngine: state.renderEngine,
  };
}

export function objectByName(state: PanelState, name: string | null): SceneObject | null {
  if (!name || !state.scene) return null;
  return state.scene.objects.find((o) => o.name === name) ?? null;
}

const fmt = (v?: number[]) =>
  v ? `[${v.map((n) => (Math.round(n * 100) / 100).toString()).join(", ")}]` : "?";

/** 给 updateModelContext 的一行摘要；与 widgetState 不重复大段内容。 */
export function selectionSummary(state: PanelState): string {
  const head = `Blender 面板：文件 ${state.file ?? "(未打开)"}（revision ${state.revision ?? "?"}）`;
  const obj = objectByName(state, state.selected);
  if (!obj) return `${head}，未选中物体。`;
  const mats = obj.materials?.length ? `，材质 ${obj.materials.join("/")}` : "";
  return `${head}，选中 ${obj.name}（${obj.type}，位置 ${fmt(obj.location)}，旋转 ${fmt(obj.rotation)}，缩放 ${fmt(obj.scale)}${mats}）。`;
}

export function revisionChangeSummary(previous: number | null, current: number | null): string {
  return `Blender 面板刷新：场景 revision 从 ${previous ?? "?"} 变为 ${current ?? "?"}，请重新 inspect_scene 后再修改。`;
}

export function followUpPrompt(
  kind: "lighting" | "camera",
  state: PanelState,
  locale = "zh",
): string {
  if (!locale.toLowerCase().startsWith("zh")) {
    const context = `Current file: ${state.file ?? "(no scene open)"}${state.selected ? `; selected object: ${state.selected}` : ""}.`;
    const goal =
      kind === "lighting"
        ? "Improve the lighting so the subject stands out."
        : "Find a better camera angle that highlights the subject while keeping some surroundings in view.";
    return `${goal} ${context} Inspect the scene first to get its revision, use expectedRevision when editing, then render_preview with engine: ${state.renderEngine}.`;
  }
  const where = `当前文件 ${state.file ?? "(未打开)"}${state.selected ? `，我在面板里选中的物体是 ${state.selected}` : ""}`;
  const tail = `先 inspect_scene 拿到 revision，修改时带 expectedRevision，改完 render_preview（engine: ${state.renderEngine}）给我看。`;
  return kind === "lighting"
    ? `帮我调一下灯光，让主体更突出。${where}。${tail}`
    : `帮我摆个更好的机位，突出主体并留一点环境。${where}。${tail}`;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i;

/** 不依赖 atob：沙箱与 node 单测共用；忽略换行与 padding。 */
export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = i + 2 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0;
    out[o++] = (a << 2) | (b >> 4);
    if (i + 2 < clean.length) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (i + 3 < clean.length) out[o++] = ((c & 3) << 6) | d;
  }
  return out.buffer.slice(0, o);
}

/** 渲染结果落后于当前场景 revision：渲染页提示"可能过期"。任一 revision 未知时不提示。 */
export function renderIsStale(state: PanelState): boolean {
  const rendered = state.render?.revision;
  return typeof rendered === "number" && state.revision !== null && rendered !== state.revision;
}

/** 路径拆成文件名与所在目录；同时认 / 与 \（Windows 工作区）。 */
export function splitPath(path: string): { name: string; dir: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut < 0 ? { name: path, dir: "" } : { name: path.slice(cut + 1), dir: path.slice(0, cut) };
}
