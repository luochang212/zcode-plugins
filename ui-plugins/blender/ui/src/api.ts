import { getClient, type PluginClient, type ToolResult } from "./client";
export type ResourceContent = Awaited<ReturnType<PluginClient["readResource"]>>["contents"][number];
export function getAlias(): PluginClient | null {
  return window.parent !== window ? getClient() : null;
}

export class PanelApi {
  constructor(private readonly api: PluginClient) {
    void api.ready().catch(() => undefined);
  }

  get theme(): "dark" | "light" {
    return this.api.theme === "dark" ? "dark" : "light";
  }
  get locale(): string {
    return this.api.locale ?? "zh-CN";
  }
  get displayMode(): string {
    return this.api.displayMode ?? "inline";
  }
  get toolOutput(): unknown {
    return this.api.toolOutput;
  }
  /** 宿主主题的 MCP Apps 标准样式变量（`--color-*` / `--font-*`）；老宿主或本地预览没有时为空对象。 */
  get styleVariables(): Record<string, string> {
    const vars = this.api.hostContext?.styles?.variables as Record<string, unknown> | undefined;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(vars ?? {}))
      if (key.startsWith("--") && typeof value === "string") out[key] = value;
    return out;
  }
  get widgetState(): unknown {
    return this.api.widgetState;
  }
  /** 面板通过官方 SDK 读取资源；保留能力检查用于本地预览。 */
  get canReadResource(): boolean {
    return typeof this.api.readResource === "function";
  }

  /** 返回 structuredContent；服务端把已知错误也放在 structuredContent.error 里，reducer 统一处理。 */
  async call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const result = (await this.api.callTool(name, args)) as ToolResult | undefined;
    return result?.structuredContent ?? null;
  }

  /** MCP 资源响应为 `{ contents: [...] }`，取第一项。 */
  async readResource(uri: string): Promise<ResourceContent | null> {
    if (!this.canReadResource) return null;
    const result = await this.api.readResource(uri);
    return result.contents[0] ?? null;
  }

  setWidgetState(state: unknown): Promise<void> {
    return this.api.setWidgetState(state).catch(() => {});
  }
  updateModelContext(text: string, structured?: object): Promise<void> {
    return this.api
      .updateModelContext({
        content: [{ type: "text", text }],
        // 官方 SDK 把 structuredContent 定为 Record；面板的 ModelContext 是普通接口对象，形状兼容。
        structuredContent: structured as Record<string, unknown> | undefined,
      })
      .catch(() => {});
  }
  sendFollowUp(prompt: string): Promise<void> {
    return this.api.sendFollowUpMessage({ prompt });
  }
  notifyHeight(height: number): void {
    this.api.notifyIntrinsicHeight(Math.ceil(height));
  }
  onGlobals(handler: () => void): void {
    window.addEventListener("plugin:change", handler);
  }
}
