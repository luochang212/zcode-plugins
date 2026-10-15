// 面板用到的线条图标（16×16，stroke 取 currentColor）。静态字符串，经 icon() 生成节点，不拼接外部输入。

const PATHS = {
  chevron: '<path d="m4 6 4 4 4-4"/>',
  copy: '<rect x="5" y="5" width="8" height="9" rx="1.5"/><path d="M10 5V2H2v9h3"/>',
  mesh: '<path d="M8 1.8 13.5 5v6L8 14.2 2.5 11V5z"/><path d="M2.5 5 8 8.2 13.5 5M8 8.2v6"/>',
  camera: '<rect x="1.8" y="4.5" width="9" height="7" rx="1.2"/><path d="m10.8 7 3.4-2v6l-3.4-2"/>',
  light:
    '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1"/>',
  empty: '<path d="M8 2v12M2 8h12M4.5 4.5l7 7M11.5 4.5l-7 7"/>',
  other: '<circle cx="8" cy="8" r="3"/>',
  eyeOff:
    '<path d="M2 2l12 12"/><path d="M6.6 3.7A6.8 6.8 0 0 1 8 3.5c3.6 0 6 4.5 6 4.5a11 11 0 0 1-1.9 2.4M4.1 5A10.6 10.6 0 0 0 2 8s2.4 4.5 6 4.5a5.9 5.9 0 0 0 2.6-.6"/>',
  refresh: '<path d="M13.5 8A5.5 5.5 0 1 1 11.9 4.1"/><path d="M12.5 1.8v2.8H9.7"/>',
  render: '<path d="M4.5 2.8v10.4L13 8z"/>',
  sparkle: '<path d="M8 1.8 9.4 6.6 14.2 8 9.4 9.4 8 14.2 6.6 9.4 1.8 8 6.6 6.6z"/>',
  fit: '<path d="M2 5.5V2h3.5M10.5 2H14v3.5M14 10.5V14h-3.5M5.5 14H2v-3.5"/>',
  focus:
    '<circle cx="8" cy="8" r="4.5"/><circle cx="8" cy="8" r="1.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2"/>',
  file: '<path d="M4 1.8h5.2L12.5 5v9.2H4z"/><path d="M9 1.8V5h3.5"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  star: '<path d="m8 2.2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4-2.9-2.8 4-.6z"/>',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, className = "icon"): SVGSVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = `<svg class="${className}" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

/** 按 Blender 对象类型选图标。 */
export function objectIcon(type: string): IconName {
  if (type === "MESH" || type === "CURVE" || type === "SURFACE" || type === "META") return "mesh";
  if (type === "CAMERA") return "camera";
  if (type === "LIGHT") return "light";
  if (type === "EMPTY") return "empty";
  return "other";
}
