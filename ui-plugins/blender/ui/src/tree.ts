// 对象树与只读属性面板。纯 DOM 渲染函数，输入 PanelState 的切片，输出到给定容器。
import type { Messages } from "./i18n";
import { icon, objectIcon } from "./icons";
import type { MaterialSummary, PanelState, SceneObject } from "./panelState";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const num = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** 按 parent 分层：顶层先，子物体缩进。同层按名字排序，和 Blender 大纲一致。 */
export function orderObjects(
  objects: SceneObject[],
): Array<{ object: SceneObject; depth: number }> {
  const byParent = new Map<string | null, SceneObject[]>();
  const names = new Set(objects.map((o) => o.name));
  for (const o of objects) {
    const parent = o.parent && names.has(o.parent) ? o.parent : null;
    const list = byParent.get(parent) ?? [];
    list.push(o);
    byParent.set(parent, list);
  }
  const out: Array<{ object: SceneObject; depth: number }> = [];
  const visit = (parent: string | null, depth: number, seen: Set<string>) => {
    for (const o of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(o.name)) continue;
      seen.add(o.name);
      out.push({ object: o, depth });
      visit(o.name, depth + 1, seen);
    }
  };
  visit(null, 0, new Set());
  return out;
}

/** 键盘导航：在树的显示顺序里取当前选中的上一个 / 下一个；未选中时 ↓ 取第一个、↑ 取最后一个。 */
export function neighbourName(state: PanelState, step: 1 | -1): string | null {
  const names = orderObjects(state.scene?.objects ?? []).map((o) => o.object.name);
  if (names.length === 0) return null;
  const at = state.selected ? names.indexOf(state.selected) : -1;
  if (at < 0) return step === 1 ? names[0] : names[names.length - 1];
  return names[Math.min(names.length - 1, Math.max(0, at + step))];
}

export function renderTree(
  container: HTMLElement,
  state: PanelState,
  t: Messages,
  onSelect: (name: string) => void,
): void {
  container.replaceChildren();
  if (!state.scene) return;
  const list = el("ul", "tree");
  for (const { object, depth } of orderObjects(state.scene.objects)) {
    const selected = object.name === state.selected;
    const item = el(
      "li",
      `tree-item${object.hidden ? " is-hidden" : ""}${selected ? " is-selected" : ""}`,
    );
    item.id = `obj-${encodeURIComponent(object.name)}`;
    item.setAttribute("role", "option");
    item.setAttribute("aria-selected", String(selected));
    item.dataset.object = object.name;
    item.dataset.type = object.type;
    item.title = `${object.name} · ${object.type}`;
    item.style.paddingLeft = `${8 + depth * 14}px`;
    item.append(icon(objectIcon(object.type), `icon type-${objectIcon(object.type)}`));
    item.append(el("span", "tree-name", object.name));
    if (object.camera?.active) {
      const mark = icon("star", "icon tree-mark");
      mark.setAttribute("aria-label", t.activeCamera);
      item.append(mark);
    }
    if (object.hidden) {
      const mark = icon("eyeOff", "icon tree-mark");
      mark.setAttribute("aria-label", t.hidden);
      item.append(mark);
    }
    item.addEventListener("click", () => onSelect(object.name));
    list.append(item);
    if (selected) queueMicrotask(() => revealInScroller(item));
  }
  container.append(list);
  container.setAttribute(
    "aria-activedescendant",
    state.selected ? `obj-${encodeURIComponent(state.selected)}` : "",
  );
}

/** 只滚动树自己的滚动容器；scrollIntoView 在 iframe 里会连带滚动宿主对话。 */
function revealInScroller(item: HTMLElement) {
  const scroller = item.closest<HTMLElement>(".scroll");
  if (!scroller) return;
  // .scroll 是 position: relative，offsetTop 即相对滚动内容的位置。
  const top = item.offsetTop;
  if (top < scroller.scrollTop) scroller.scrollTop = top;
  else if (top + item.offsetHeight > scroller.scrollTop + scroller.clientHeight)
    scroller.scrollTop = top + item.offsetHeight - scroller.clientHeight;
}

function row(label: string, value: string | Node): HTMLElement {
  const r = el("div", "prop-row");
  const v = el("span", "prop-value");
  v.append(value);
  r.append(el("span", "prop-label", label), v);
  return r;
}

/** X/Y/Z 三列；轴标签按 Blender 惯例着色。 */
function vecRow(label: string, v: number[] | undefined, unit = ""): HTMLElement {
  const r = el("div", "prop-vec");
  r.append(el("span", "prop-label", label));
  (["x", "y", "z"] as const).forEach((axis, i) => {
    const cell = el("span", "vec-cell");
    cell.append(el("span", `axis axis-${axis}`, axis.toUpperCase()));
    cell.append(el("span", "vec-num", v && typeof v[i] === "number" ? `${num(v[i])}${unit}` : "—"));
    r.append(cell);
  });
  return r;
}

function colorSwatch(color: number[] | null | undefined): Node {
  if (!color) return document.createTextNode("—");
  const [r, g, b] = color.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
  const wrap = document.createDocumentFragment();
  const swatch = el("span", "swatch");
  swatch.style.background = `rgb(${r}, ${g}, ${b})`;
  const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  wrap.append(swatch, document.createTextNode(hex));
  return wrap;
}

/** 0–1 的数值配一根细条，一眼看出金属度 / 粗糙度高低。 */
function meter(value: number): Node {
  const wrap = document.createDocumentFragment();
  const bar = el("span", "meter");
  const fill = el("span", "meter-fill");
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
  bar.append(fill);
  wrap.append(bar, document.createTextNode(num(value)));
  return wrap;
}

export function renderProps(container: HTMLElement, state: PanelState, t: Messages): void {
  container.replaceChildren();
  const obj = state.scene?.objects.find((o) => o.name === state.selected);
  if (!obj) {
    container.append(el("div", "props-empty muted", t.noSelection));
    return;
  }
  const head = el("div", "prop-head");
  head.append(icon(objectIcon(obj.type), `icon type-${objectIcon(obj.type)}`));
  head.append(el("strong", "prop-title", obj.name), el("span", "prop-type", obj.type));
  container.append(head);

  container.append(el("div", "prop-sub", t.transform));
  container.append(
    vecRow(t.location, obj.location),
    vecRow(t.rotation, obj.rotation, "°"),
    vecRow(t.scale, obj.scale),
  );
  if (obj.dimensions && obj.dimensions.some((d) => d > 0))
    container.append(vecRow(t.dimensions, obj.dimensions));

  container.append(el("div", "prop-sub", t.info));
  const visibility = `${obj.hidden ? t.hidden : t.visible}${obj.hideRender ? ` · ${t.renderHidden}` : ""}`;
  container.append(row(t.visibility, visibility));
  if (typeof obj.faces === "number") container.append(row(t.faces, obj.faces.toLocaleString()));
  if (obj.light) container.append(row(t.light, `${obj.light.type} · ${num(obj.light.energy)} W`));
  if (obj.camera)
    container.append(
      row(t.lens, `${num(obj.camera.lens)} mm${obj.camera.active ? ` · ${t.activeCamera}` : ""}`),
    );

  const materials = (obj.materials ?? []).map(
    (name) => state.scene?.materials.find((m) => m.name === name) ?? ({ name } as MaterialSummary),
  );
  for (const material of materials) {
    container.append(el("div", "prop-sub", `${t.material} · ${material.name}`));
    container.append(row(t.baseColor, colorSwatch(material.baseColor)));
    if (typeof material.metallic === "number")
      container.append(row(t.metallic, meter(material.metallic)));
    if (typeof material.roughness === "number")
      container.append(row(t.roughness, meter(material.roughness)));
  }
}
