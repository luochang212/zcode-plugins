// 假引擎用的内置资产：程序生成一个合法的极小 GLB（一个立方体 mesh，多个节点复用）与一张 1×1 PNG。
// 不读任何外部文件，便于 CI 与 e2e 在没有 Blender 的机器上跑通面板数据流。

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

// 立方体 8 个顶点、12 个三角形（逆时针朝外，Three.js 默认只画正面）。
const CUBE_POSITIONS = [
  -1,
  -1,
  -1,
  1,
  -1,
  -1,
  1,
  1,
  -1,
  -1,
  1,
  -1, // z = -1
  -1,
  -1,
  1,
  1,
  -1,
  1,
  1,
  1,
  1,
  -1,
  1,
  1, // z = +1
];
const CUBE_INDICES = [
  4,
  5,
  6,
  4,
  6,
  7, // +Z
  1,
  0,
  3,
  1,
  3,
  2, // -Z
  5,
  1,
  2,
  5,
  2,
  6, // +X
  0,
  4,
  7,
  0,
  7,
  3, // -X
  3,
  7,
  6,
  3,
  6,
  2, // +Y
  0,
  1,
  5,
  0,
  5,
  4, // -Y
];

/** 默认三个节点，名字与假桥场景里的三个 MESH 对象一致，面板按名字匹配高亮。glTF 是 y-up。 */
export const DEFAULT_GLB_NODES = [
  { name: "Cube", translation: [0, 1, 0], scale: [1, 1, 1], color: [0.8, 0.2, 0.2, 1] },
  { name: "Sphere", translation: [3, 0.6, 0], scale: [0.6, 0.6, 0.6], color: [0.2, 0.5, 0.9, 1] },
  { name: "Plane", translation: [0, -0.02, 0], scale: [4, 0.02, 4], color: [0.6, 0.6, 0.6, 1] },
];

function pad4(buffer, fill) {
  const rest = buffer.length % 4;
  return rest === 0 ? buffer : Buffer.concat([buffer, Buffer.alloc(4 - rest, fill)]);
}

/** 生成 GLB 二进制（Buffer）。nodes 里每项 { name, translation, scale, color } 各成一个节点 + 一份材质，共用同一个 mesh 几何。 */
export function buildCubeGlb(nodes = DEFAULT_GLB_NODES) {
  const positions = Buffer.from(new Float32Array(CUBE_POSITIONS).buffer);
  const indices = Buffer.from(new Uint16Array(CUBE_INDICES).buffer);
  const bin = pad4(Buffer.concat([positions, indices]), 0);
  const json = {
    asset: { version: "2.0", generator: "blender fake engine" },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes: nodes.map((n, i) => ({
      name: n.name,
      mesh: i,
      translation: n.translation,
      scale: n.scale,
    })),
    meshes: nodes.map((n, i) => ({
      name: `${n.name}_Mesh`,
      primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: i }],
    })),
    materials: nodes.map((n) => ({
      name: `${n.name}_Material`,
      pbrMetallicRoughness: { baseColorFactor: n.color, metallicFactor: 0, roughnessFactor: 0.6 },
    })),
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 8,
        type: "VEC3",
        min: [-1, -1, -1],
        max: [1, 1, 1],
      },
      { bufferView: 1, componentType: 5123, count: CUBE_INDICES.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: indices.length, target: 34963 },
    ],
    buffers: [{ byteLength: bin.length }],
  };
  const jsonChunk = pad4(Buffer.from(JSON.stringify(json), "utf8"), 0x20);
  const header = Buffer.alloc(12);
  const total = 12 + 8 + jsonChunk.length + 8 + bin.length;
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(CHUNK_JSON, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(bin.length, 0);
  binHeader.writeUInt32LE(CHUNK_BIN, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, bin]);
}

/** 解析 GLB 头与两个块（测试与自检用）。 */
export function parseGlb(buffer) {
  if (buffer.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not a GLB: bad magic");
  const version = buffer.readUInt32LE(4);
  const length = buffer.readUInt32LE(8);
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== CHUNK_JSON) throw new Error("first chunk is not JSON");
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString("utf8"));
  const binOffset = 20 + jsonLength;
  const binLength = buffer.readUInt32LE(binOffset);
  if (buffer.readUInt32LE(binOffset + 4) !== CHUNK_BIN) throw new Error("second chunk is not BIN");
  return {
    version,
    length,
    json,
    jsonLength,
    binLength,
    bin: buffer.subarray(binOffset + 8, binOffset + 8 + binLength),
  };
}

/** 1×1 透明 PNG。 */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
