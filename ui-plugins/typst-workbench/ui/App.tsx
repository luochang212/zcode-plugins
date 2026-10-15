import { useCallback, useState } from "react";
import { MIN_TYPST, type SessionState } from "#t/contract.ts";
import { host } from "#ui/bridge.ts";
import { Toast, errorText, useHostContext } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Preview } from "#ui/Preview.tsx";
import { refreshState, useSnapshot } from "#ui/store.ts";

type Notify = (message: string, tone?: "info" | "error") => void;

const INSTALL = [
  { os: "macOS", command: "brew install typst" },
  { os: "Windows", command: "winget install --id Typst.Typst" },
  { os: "Linux / any", command: "cargo install --locked typst-cli" },
];

function CheckAgain({ s, notify }: { s: Strings; notify: Notify }) {
  const [checking, setChecking] = useState(false);
  return (
    <button
      type="button"
      className="btn outline sm"
      disabled={checking}
      onClick={() => {
        setChecking(true);
        void host
          .call("restart")
          .catch((error) => notify(errorText(error), "error"))
          .then(() => refreshState())
          .finally(() => setChecking(false));
      }}
    >
      <Icon name="refresh" size={14} />
      {s.checkAgain}
    </button>
  );
}

/** 找不到 typst、版本过旧或无法运行时的说明页。 */
function ToolchainScreen({ state, s, notify }: { state: SessionState; s: Strings; notify: Notify }) {
  const { toolchain } = state;
  if (toolchain.state === "unknown")
    return (
      <div className="center">
        <span className="spinner lg" />
        <p className="muted">{s.findingTypst}</p>
      </div>
    );
  const title =
    toolchain.state === "missing" ? s.missingTitle : toolchain.state === "too_old" ? s.tooOldTitle(toolchain.version ?? "") : s.errorTitle;
  return (
    <div className="center status-screen">
      <div className="tile lg">
        <Icon name={toolchain.state === "missing" ? "power" : "alert"} size={22} />
      </div>
      <h2>{title}</h2>
      {toolchain.state === "missing" && (
        <>
          <p className="muted">{s.missingBody}</p>
          <ul className="install">
            {INSTALL.map((entry) => (
              <li key={entry.os}>
                <span className="muted small">{entry.os}</span>
                <code>{entry.command}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {toolchain.state === "too_old" && <p className="muted">{s.tooOldBody(MIN_TYPST.join("."), toolchain.path ?? "typst")}</p>}
      {toolchain.state === "error" && <pre className="error-box">{toolchain.error}</pre>}
      <p className="muted small">{s.settingHint}</p>
      <CheckAgain s={s} notify={notify} />
    </div>
  );
}

/** 没有主文件：列出 .typ 文件供选择，或说明还没有。 */
function ChooseMain({ state, s, notify }: { state: SessionState; s: Strings; notify: Notify }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!state.candidates.length)
    return (
      <div className="center status-screen">
        <div className="tile lg">
          <Icon name="file" size={22} />
        </div>
        <h2>{s.noFilesTitle}</h2>
        <p className="muted">{s.noFilesBody}</p>
        <CheckAgain s={s} notify={notify} />
      </div>
    );
  return (
    <div className="center status-screen">
      <h2>{s.chooseTitle}</h2>
      <p className="muted">{s.chooseBody}</p>
      <ul className="file-list">
        {state.candidates.map((path) => (
          <li key={path}>
            <button
              type="button"
              className="file-row"
              disabled={!!busy}
              onClick={() => {
                setBusy(path);
                void host
                  .call("panel_set_main", { path })
                  .catch((error) => notify(errorText(error), "error"))
                  .finally(() => setBusy(null));
              }}
            >
              <Icon name="file" size={15} />
              <span className="ellipsis grow">{path}</span>
              {busy === path ? <span className="spinner" /> : <Icon name="chevronRight" size={14} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 对话中的卡片：编译状态与“在侧栏打开”。 */
function InlineCard({ state, s }: { state: SessionState | null; s: Strings }) {
  const errors = state?.diagnostics.filter((entry) => entry.severity === "error").length ?? 0;
  const ok = !!state && state.toolchain.state === "ready" && !!state.main && errors === 0 && state.status.phase !== "crashed";
  const sub = !state
    ? s.connecting
    : state.toolchain.state === "missing"
      ? s.missingTitle
      : !state.main
        ? s.noFilesTitle
        : errors
          ? `${state.main} · ${s.errors(errors)}`
          : state.snapshot
            ? `${state.main} · ${s.inlineReady(state.snapshot.pages)}`
            : `${state.main} · ${s.compiling}`;
  return (
    <div className="inline-card">
      <div className="tile">
        <Icon name="file" />
      </div>
      <div className="grow">
        <div className="name">{s.title}</div>
        <div className="sub">
          <span className={`lamp ${ok ? "ok" : "bad"}`} />
          <span className="ellipsis">{sub}</span>
        </div>
      </div>
      <button type="button" className="btn outline sm" aria-label={s.openPanel} title={s.openPanel} onClick={() => void host.requestFullscreen()}>
        <Icon name="panel" size={15} />
        {s.open}
      </button>
    </div>
  );
}

export function App() {
  const snap = useSnapshot();
  const { s, inline } = useHostContext();
  const [toast, setToast] = useState<{ message: string; tone?: "info" | "error" } | null>(null);
  const notify = useCallback((message: string, tone?: "info" | "error") => setToast({ message, tone }), []);
  const dismiss = useCallback(() => setToast(null), []);

  if (inline) return <InlineCard state={snap.state} s={s} />;
  if (!snap.connected || !snap.state)
    return <div className="center">{snap.error ? <pre className="error-box">{snap.error}</pre> : s.connecting}</div>;

  const state = snap.state;
  let view;
  if (state.toolchain.state !== "ready") view = <ToolchainScreen state={state} s={s} notify={notify} />;
  else if (!state.main) view = <ChooseMain state={state} s={s} notify={notify} />;
  else view = <Preview state={state} s={s} notify={notify} />;
  return (
    <div className="app">
      {view}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismiss} />}
    </div>
  );
}
