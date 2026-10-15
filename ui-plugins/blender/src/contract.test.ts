import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_ID as RUNTIME_PLUGIN_ID } from "./engine.mjs";
import { configFromEnv, createBlenderServer } from "./server-factory.mjs";
import {
  HTML_MIME as RUNTIME_HTML_MIME,
  PANEL_URI as RUNTIME_PANEL_URI,
  SURFACE_ID as RUNTIME_SURFACE_ID,
} from "./tools/common.mjs";
import { ENSURE_ENGINE_TIMEOUT_MS as RUNTIME_ENSURE_TIMEOUT } from "./tools/engine-tools.mjs";
import {
  APP_ONLY_TOOLS,
  CORE_TOOLS,
  ENSURE_ENGINE_TIMEOUT_MS,
  ERROR_CODES,
  EXPORT_URI_TEMPLATE,
  FULLSCREEN_TOOLS,
  HTML_MIME,
  OPTIONAL_TOOLS,
  PANEL_URI,
  PLUGIN_ID,
  RENDER_URI_TEMPLATE,
  SURFACE_ID,
} from "./contract";
import { conflictExample } from "./contract.example";

const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});

async function connectFake(env: Record<string, string> = {}) {
  const workspace = await mkdtemp(join(tmpdir(), "zcode-blender-contract-"));
  closers.push(() => rm(workspace, { recursive: true, force: true }));
  const created = createBlenderServer({
    config: configFromEnv({ ZCODE_BLENDER_FAKE_ENGINE: "1", ...env }),
    workspaceRoot: workspace,
    outputRoot: join(workspace, "out"),
  });
  closers.push(() => created.close());
  const client = new Client({ name: "contract", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([created.server.connect(a), client.connect(b)]);
  return client;
}

describe("Blender contract", () => {
  it("TS 镜像与 .mjs 运行时常量一致", () => {
    expect(PLUGIN_ID).toBe(RUNTIME_PLUGIN_ID);
    expect(PANEL_URI).toBe(RUNTIME_PANEL_URI);
    expect(SURFACE_ID).toBe(RUNTIME_SURFACE_ID);
    expect(HTML_MIME).toBe(RUNTIME_HTML_MIME);
    expect(ENSURE_ENGINE_TIMEOUT_MS).toBe(RUNTIME_ENSURE_TIMEOUT);
  });

  it("真实 server 的工具表、可见性、fullscreen 偏好与资源模板与合同一致", async () => {
    const client = await connectFake();
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...CORE_TOOLS].sort());
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    for (const name of APP_ONLY_TOOLS)
      expect(byName[name]._meta?.ui).toMatchObject({ visibility: ["app"] });
    for (const name of FULLSCREEN_TOOLS) {
      expect(byName[name]._meta).toMatchObject({
        ui: { resourceUri: PANEL_URI, surface: SURFACE_ID, visibility: ["model", "app"] },
        "openai/ui": { preferredModelDisplayMode: "fullscreen" },
      });
    }
    const templates = (await client.listResourceTemplates()).resourceTemplates.map(
      (t) => t.uriTemplate,
    );
    expect(templates).toEqual(expect.arrayContaining([RENDER_URI_TEMPLATE, EXPORT_URI_TEMPLATE]));
    const panel = await client.readResource({ uri: PANEL_URI });
    expect(panel.contents[0]).toMatchObject({ uri: PANEL_URI, mimeType: HTML_MIME });

    const withPython = await connectFake({ ZCODE_BLENDER_ALLOW_PYTHON: "1" });
    const names = (await withPython.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([...OPTIONAL_TOOLS]));
  });

  it("过期 revision 的回包符合 ToolStructuredContent 信封", async () => {
    const client = await connectFake();
    const result: any = await client.callTool({
      name: "add_object",
      arguments: { type: "cube", expectedRevision: 99 },
    });
    expect(result.isError).toBe(true);
    expect(ERROR_CODES).toContain(result.structuredContent.error.code);
    expect(result.structuredContent).toMatchObject({
      error: { code: conflictExample.error?.code, details: { expectedRevision: 99 } },
      state: { revision: expect.any(Number) },
    });
  });
});
