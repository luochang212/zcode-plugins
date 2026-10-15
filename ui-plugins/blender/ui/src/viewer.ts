// Three.js 预览：GLB 解析、OrbitControls、网格地面、点选高亮。只管画面，不持有业务状态。
import {
  AmbientLight,
  Box3,
  BoxHelper,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { CameraPose } from "./panelState";

export interface ViewerCallbacks {
  onSelect(name: string | null): void;
  /** 双击物体：选中并聚焦（面板据此同步选中状态）。 */
  onFocus(name: string): void;
  onCameraEnd(pose: CameraPose): void;
}

export interface Viewer {
  loadGlb(buffer: ArrayBuffer): Promise<string[]>;
  setKnownNames(names: string[]): void;
  setSelected(name: string | null): void;
  setCameraPose(pose: CameraPose | null): void;
  getCameraPose(): CameraPose;
  /** 相机对准全部内容 / 某个物体；true 表示确实移动了相机。 */
  frameAll(): boolean;
  frameObject(name: string): boolean;
  setTheme(theme: "dark" | "light"): void;
  resize(): void;
  dispose(): void;
}

const CLICK_SLOP_PX = 4;

export function createViewer(host: HTMLElement, callbacks: ViewerCallbacks): Viewer {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const scene = new Scene();
  const camera = new PerspectiveCamera(45, 1, 0.01, 2000);
  camera.position.set(6, 4, 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.target.set(0, 0.5, 0);
  controls.update();

  scene.add(new AmbientLight(0xffffff, 0.9));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(5, 10, 7);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.6);
  fill.position.set(-6, 3, -4);
  scene.add(fill);
  // GridHelper 用顶点色，改材质色只会相乘；换主题时整根重建。
  let currentTheme: "dark" | "light" | null = null;
  let grid = new GridHelper(20, 20, 0x9aa0a8, 0xd9dce1);
  scene.add(grid);

  const content = new Group();
  scene.add(content);
  let highlight: BoxHelper | null = null;
  let knownNames = new Set<string>();
  const byName = new Map<string, Object3D>();

  function render() {
    renderer.render(scene, camera);
  }
  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    render();
  }
  const observer = new ResizeObserver(() => resize());
  observer.observe(host);
  resize();

  controls.addEventListener("change", render);
  controls.addEventListener("end", () => callbacks.onCameraEnd(getCameraPose()));

  // 点选：pointerdown 记起点，pointerup 位移小于阈值才算点击，避免和拖拽旋转冲突。
  const raycaster = new Raycaster();
  let downAt: { x: number; y: number } | null = null;
  function pick(e: MouseEvent): string | null {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(content.children, true)[0];
    return hit ? resolveName(hit.object) : null;
  }
  renderer.domElement.addEventListener("pointerdown", (e) => {
    downAt = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > CLICK_SLOP_PX || e.button !== 0) return;
    callbacks.onSelect(pick(e));
  });
  renderer.domElement.addEventListener("dblclick", (e) => {
    const name = pick(e);
    if (name) callbacks.onFocus(name);
  });
  // 悬停可选物体时换手型；按帧节流，拖拽中不做射线检测。
  let hoverQueued = false;
  renderer.domElement.addEventListener("pointermove", (e) => {
    if (downAt || hoverQueued) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      renderer.domElement.style.cursor = pick(e) ? "pointer" : "";
    });
  });

  /** 命中的 Mesh 往上找第一个名字在对象树里的祖先（Blender 导出时 mesh 节点常带 "_Mesh" 后缀或挂在同名父节点下）。 */
  function resolveName(obj: Object3D): string | null {
    let cur: Object3D | null = obj;
    while (cur && cur !== content) {
      if (knownNames.has(cur.name)) return cur.name;
      cur = cur.parent;
    }
    cur = obj;
    while (cur && cur !== content) {
      if (cur.name) return cur.name;
      cur = cur.parent;
    }
    return null;
  }

  function indexNames(root: Object3D) {
    byName.clear();
    root.traverse((o) => {
      if (o.name && !byName.has(o.name)) byName.set(o.name, o);
    });
  }

  /** 按包围球与 FOV 算相机距离：保持当前观察方向，让目标完整落在画面里。 */
  /** margin：整体适配留 10%；聚焦单个物体留更多余量，保留周围参照。 */
  function frameBox(box: Box3, margin = 1.1): boolean {
    if (box.isEmpty()) return false;
    const sphere = box.getBoundingSphere(new Sphere());
    const radius = Math.max(sphere.radius, 0.05);
    const halfFov = ((camera.fov / 2) * Math.PI) / 180;
    const fit = Math.min(halfFov, Math.atan(Math.tan(halfFov) * camera.aspect));
    const distance = (radius / Math.sin(fit)) * margin;
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 1e-8) direction.set(1.2, 0.9, 1.6);
    direction.normalize();
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    camera.near = Math.max(0.01, distance / 200);
    camera.far = distance * 200;
    camera.updateProjectionMatrix();
    controls.update();
    render();
    return true;
  }
  function frameContent(): boolean {
    return frameBox(new Box3().setFromObject(content));
  }

  function getCameraPose(): CameraPose {
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    };
  }

  return {
    async loadGlb(buffer) {
      const loader = new GLTFLoader();
      const gltf = await new Promise<{ scene: Group }>((resolve, reject) =>
        loader.parse(buffer, "", resolve, reject),
      );
      const hadContent = content.children.length > 0;
      content.clear();
      if (highlight) {
        scene.remove(highlight);
        highlight = null;
      }
      content.add(gltf.scene);
      indexNames(gltf.scene);
      if (!hadContent) frameContent();
      render();
      return [...byName.keys()];
    },
    setKnownNames(names) {
      knownNames = new Set(names);
    },
    setSelected(name) {
      if (highlight) {
        scene.remove(highlight);
        highlight.dispose();
        highlight = null;
      }
      const target = name ? byName.get(name) : null;
      if (target) {
        // 选中框只包住这一棵子树；Mesh 为空组时 BoxHelper 会得到空盒，setFromObject 内部处理。
        highlight = new BoxHelper(target, 0xffb000);
        scene.add(highlight);
      }
      render();
    },
    setCameraPose(pose) {
      if (!pose) return;
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
      controls.update();
      render();
    },
    getCameraPose,
    frameAll: frameContent,
    frameObject(name) {
      const target = byName.get(name);
      return target ? frameBox(new Box3().setFromObject(target), 2) : false;
    },
    setTheme(theme) {
      // 宿主每次 globals 变化都会调到这里；主题没变就不重建网格。
      if (theme === currentTheme) return;
      currentTheme = theme;
      scene.background = new Color(theme === "dark" ? 0x1c1d21 : 0xf2f3f5);
      scene.remove(grid);
      grid.dispose();
      grid =
        theme === "dark"
          ? new GridHelper(20, 20, 0x5a5e66, 0x34363c)
          : new GridHelper(20, 20, 0x9aa0a8, 0xd9dce1);
      scene.add(grid);
      render();
    },
    resize,
    dispose() {
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      content.traverse((o) => {
        const mesh = o as Mesh;
        mesh.geometry?.dispose?.();
      });
      host.removeChild(renderer.domElement);
    },
  };
}
