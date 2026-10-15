// Blender 桥客户端：起 `<blender> -b --python blender/bridge.py -- --zcode-bridge ...`，
// 用 stdin/stdout 走 JSON-lines：请求 {id, cmd, args}，响应 {id, ok, result|error}。
// 设计要点：
//   - 一个工作区一个进程（createBridgeRegistry 按 workspaceRoot 复用）；
//   - 每条命令有超时；进程崩溃时拒绝所有在途请求，下一次调用惰性重启并重新 open 上一次的文件；
//   - 空闲 5 分钟自动退出；已发送的命令中止时停止进程，尚未发送的取消只拒绝请求。
import { spawn as nodeSpawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_BRIDGE_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "blender",
  "bridge.py",
);
export const DEFAULT_IDLE_MS = 5 * 60 * 1000;
export const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
export const DEFAULT_STARTUP_TIMEOUT_MS = 90_000;

export class BridgeError extends Error {
  constructor(message, { code = "bridge_error", state, details } = {}) {
    super(message);
    this.name = "BridgeError";
    this.code = code;
    this.state = state;
    this.details = details;
  }
}

export function createBridgeClient({
  blenderPath,
  workspaceRoot,
  outputRoot,
  bridgeScript = DEFAULT_BRIDGE_SCRIPT,
  spawn = nodeSpawn,
  idleMs = DEFAULT_IDLE_MS,
  commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  onLog = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  if (!blenderPath) throw new Error("createBridgeClient 需要 blenderPath");
  let child = null;
  let ready = null; // promise 包含启动与文件恢复；resolve/reject 只对应进程 ready 事件
  let nextId = 1;
  const pending = new Map(); // id → { resolve, reject, timer }
  let lastState = null;
  let lastOpenedFile = null;
  let idleTimer = null;
  let closed = false;

  function armIdle() {
    if (idleTimer) clearTimeoutFn(idleTimer);
    idleTimer = setTimeoutFn(() => {
      idleTimer = null;
      if (pending.size === 0 && child) {
        onLog("info", "bridge idle, exiting Blender");
        stopChild();
      }
    }, idleMs);
    idleTimer?.unref?.();
  }

  function stopChild(
    error = new BridgeError("Blender process stopped", {
      code: "process_crashed",
      state: lastState,
    }),
  ) {
    const proc = child;
    const startup = ready;
    child = null;
    ready = null;
    if (!proc) return;
    startup?.reject(error);
    failAllPending(error);
    try {
      proc.stdin.end(`${JSON.stringify({ id: 0, cmd: "quit", args: {} })}\n`);
    } catch {
      /* 已关闭 */
    }
    const killer = setTimeoutFn(() => proc.kill("SIGKILL"), 3000);
    killer?.unref?.();
    proc.once("exit", () => clearTimeoutFn(killer));
  }

  function failAllPending(error) {
    for (const [id, entry] of pending) {
      pending.delete(id);
      clearTimeoutFn(entry.timer);
      entry.reject(error);
    }
  }

  function handleLine(line) {
    const text = line.trim();
    if (!text) return;
    if (!text.startsWith("{")) {
      onLog("debug", `blender: ${text}`); // Blender 自己的启动信息等噪音
      return;
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      onLog("debug", `blender(non-json): ${text}`);
      return;
    }
    if (msg.event === "ready") {
      ready?.resolve(msg);
      return;
    }
    if (msg.event === "log") {
      onLog("debug", `bridge: ${msg.message}`);
      return;
    }
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeoutFn(entry.timer);
    if (msg.state) lastState = msg.state;
    if (msg.ok) {
      // 原来只在 open 后记路径，new_scene/另存后的进程重启会漏加载工程，退回默认方块。
      if (typeof msg.state?.file === "string" && msg.state.file) lastOpenedFile = msg.state.file;
      entry.resolve(msg.result ?? null);
    } else {
      const err = msg.error ?? {};
      entry.reject(
        new BridgeError(err.message ?? "bridge command failed", {
          code: err.code ?? "command_failed",
          state: msg.state ?? lastState,
          details: err.details,
        }),
      );
    }
  }

  function startChild() {
    const args = [
      "-b",
      "--python",
      bridgeScript,
      "--",
      "--zcode-bridge",
      "--workspace",
      workspaceRoot,
    ];
    if (outputRoot) args.push("--output-root", outputRoot);
    const proc = spawn(blenderPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ZCODE_WORKSPACE_ROOT: workspaceRoot, PYTHONUNBUFFERED: "1" },
    });
    child = proc;
    let resolveReady;
    let rejectReady;
    const readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const startupTimer = setTimeoutFn(
      () =>
        rejectReady(
          new BridgeError("Blender bridge did not become ready in time", {
            code: "startup_timeout",
          }),
        ),
      startupTimeoutMs,
    );
    startupTimer?.unref?.();
    readyPromise.finally(() => clearTimeoutFn(startupTimer)).catch(() => {});
    ready = { promise: readyPromise, resolve: resolveReady, reject: rejectReady };

    let buffer = "";
    proc.stdout.setEncoding?.("utf8");
    proc.stdout.on("data", (chunk) => {
      if (child !== proc) return; // 已停止进程的迟到 ready/响应不能作用于替代进程。
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    });
    proc.stderr?.setEncoding?.("utf8");
    proc.stderr?.on("data", (chunk) =>
      onLog("debug", `blender(stderr): ${String(chunk).trimEnd()}`),
    );
    proc.on("error", (error) => {
      rejectReady(
        new BridgeError(`failed to spawn Blender: ${error.message}`, { code: "spawn_failed" }),
      );
      if (child !== proc) return;
      child = null;
      ready = null;
      failAllPending(
        new BridgeError(`Blender process error: ${error.message}`, { code: "process_error" }),
      );
    });
    proc.on("exit", (code, signal) => {
      if (child !== proc) return; // stopChild 已拒绝所属请求，旧 exit 不能拒绝新进程的请求。
      if (buffer) handleLine(buffer);
      buffer = "";
      child = null;
      ready = null;
      rejectReady(
        new BridgeError(`Blender exited during startup (code ${code}, signal ${signal})`, {
          code: "startup_exit",
        }),
      );
      if (pending.size > 0) {
        onLog("warn", `Blender exited with pending commands (code ${code}, signal ${signal})`);
        failAllPending(
          new BridgeError(
            `Blender process exited (code ${code}, signal ${signal ?? "none"}); it will be restarted on the next command`,
            { code: "process_crashed", state: lastState },
          ),
        );
      }
    });
    return proc;
  }

  async function ensureProcess() {
    if (closed) throw new BridgeError("bridge client is closed", { code: "closed" });
    if (child) return ready.promise;
    const file = lastOpenedFile;
    const proc = startChild();
    // 并发 inspect/export 必须共用完整恢复屏障，不能只等 ready 就导出默认场景。
    ready.promise = ready.promise
      .then(async () => {
        if (file) {
          onLog("info", `bridge restarted, re-opening ${file}`);
          await send("open", { path: file }, { timeoutMs: commandTimeoutMs });
        }
      })
      .catch((error) => {
        if (child === proc) stopChild(error); // 恢复失败不能留下可被后续命令使用的默认场景。
        throw error;
      });
    return ready.promise;
  }

  function checkAbort(cmd, signal) {
    if (signal?.aborted)
      throw new BridgeError(`command ${cmd} aborted`, { code: "aborted", state: lastState });
  }

  function send(cmd, args, { timeoutMs = commandTimeoutMs, signal } = {}) {
    return new Promise((resolve, reject) => {
      // 确认超时后的迟到 save 尚未发送，拒绝即可；不能因此停止承载新编辑的健康进程。
      checkAbort(cmd, signal);
      if (!child) return reject(new BridgeError("no Blender process", { code: "no_process" }));
      const id = nextId++;
      const timer = setTimeoutFn(() => {
        pending.delete(id);
        signal?.removeEventListener("abort", onAbort); // 超时已结束请求，迟到取消不能再停止替代进程。
        reject(
          new BridgeError(`command ${cmd} timed out after ${timeoutMs} ms`, {
            code: "timeout",
            state: lastState,
          }),
        );
        // 命令卡死时 Blender 主线程不可打断，杀掉进程让下一次调用重启。
        stopChild();
      }, timeoutMs);
      timer?.unref?.();
      const onAbort = () => {
        pending.delete(id);
        clearTimeoutFn(timer);
        reject(new BridgeError(`command ${cmd} aborted`, { code: "aborted", state: lastState }));
        stopChild();
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
      pending.set(id, {
        resolve: (v) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(v);
        },
        reject: (e) => {
          signal?.removeEventListener("abort", onAbort);
          reject(e);
        },
        timer,
      });
      child.stdin.write(`${JSON.stringify({ id, cmd, args: args ?? {} })}\n`);
    });
  }

  async function call(cmd, args = {}, options = {}) {
    checkAbort(cmd, options.signal);
    await ensureProcess();
    armIdle();
    try {
      return await send(cmd, args, options);
    } finally {
      armIdle();
    }
  }

  return {
    call,
    get state() {
      return lastState;
    },
    get lastOpenedFile() {
      return lastOpenedFile;
    },
    isRunning: () => child !== null,
    async close() {
      closed = true;
      if (idleTimer) clearTimeoutFn(idleTimer);
      failAllPending(new BridgeError("bridge closed", { code: "closed" }));
      stopChild();
    },
  };
}

/** 按工作区复用桥进程；引擎路径变化时替换旧进程。 */
export function createBridgeRegistry(factory = createBridgeClient) {
  const clients = new Map();
  return {
    get(workspaceRoot, options) {
      const existing = clients.get(workspaceRoot);
      if (existing && existing.blenderPath === options.blenderPath) return existing.client;
      existing?.client.close();
      const client = factory({ ...options, workspaceRoot });
      clients.set(workspaceRoot, { client, blenderPath: options.blenderPath });
      return client;
    },
    peek(workspaceRoot) {
      return clients.get(workspaceRoot)?.client ?? null;
    },
    async closeAll() {
      await Promise.all([...clients.values()].map((entry) => entry.client.close()));
      clients.clear();
    },
  };
}
