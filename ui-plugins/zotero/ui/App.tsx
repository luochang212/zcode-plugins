import { useCallback, useState } from "react";
import type { SessionState } from "#z/contract.ts";
import { host } from "#ui/bridge.ts";
import { Toast, errorText, useHostContext } from "#ui/common.tsx";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { ItemView } from "#ui/ItemView.tsx";
import { ItemsView, LibraryView } from "#ui/Library.tsx";
import { Reader } from "#ui/Reader.tsx";
import { back, refreshState, useSnapshot } from "#ui/store.ts";

/** Zotero 未运行 / 本地 API 未开启 / 出错时的说明页。 */
function StatusScreen({ state, s }: { state: SessionState; s: Strings }) {
  const [checking, setChecking] = useState(false);
  const status = state.status;
  const [title, body] =
    status.state === "api_disabled"
      ? [s.apiDisabledTitle, status.error && /version/.test(status.error) ? status.error : s.apiDisabledBody]
      : status.state === "error"
        ? [s.errorTitle, status.error ?? ""]
        : [s.notRunningTitle, s.notRunningBody];
  return (
    <div className="center status-screen">
      <div className="tile lg">
        <Icon name={status.state === "not_running" ? "power" : "alert"} size={22} />
      </div>
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <button
        type="button"
        className="btn outline sm"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          void host
            .call("panel_refresh")
            .catch(() => undefined)
            .then(() => refreshState())
            .finally(() => setChecking(false));
        }}
      >
        <Icon name="refresh" size={14} />
        {s.checkAgain}
      </button>
    </div>
  );
}

/** 对话中的卡片：连接状态、正在看的内容与“在侧栏打开”。 */
function InlineCard({ state, s }: { state: SessionState | null; s: Strings }) {
  const view = state?.view;
  const ready = state?.status.state === "ready";
  const sub = !state
    ? s.connecting
    : !ready
      ? s.notRunningTitle
      : view?.kind === "items"
        ? view.title
        : s.inlineReady(state.highlights.length);
  return (
    <div className="inline-card">
      <div className="tile">
        <Icon name="library" />
      </div>
      <div className="grow">
        <div className="name">{s.title}</div>
        <div className="sub">
          <span className={`lamp ${ready ? "ok" : "bad"}`} />
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
  if (state.status.state !== "ready" && state.status.state !== "unknown") return <StatusScreen state={state} s={s} />;

  const route = snap.stack.at(-1)!;
  const onBack = () => back();
  let view;
  switch (route.kind) {
    case "library":
      view = <LibraryView key={`${route.library}`} route={route} state={state} s={s} notify={notify} />;
      break;
    case "items":
      view = <ItemsView key={`${route.title}:${route.keys.join()}`} route={route} s={s} notify={notify} onBack={onBack} />;
      break;
    case "item":
      view = <ItemView key={route.key} route={route} state={state} s={s} notify={notify} onBack={onBack} />;
      break;
    case "reader":
      view = <Reader key={`${route.library}/${route.attachmentKey}`} route={route} state={state} s={s} notify={notify} onBack={onBack} />;
      break;
  }
  return (
    <div className="app">
      {view}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismiss} />}
      {state.authorizing && route.kind !== "reader" && <div className="banner">{s.waitingApproval}</div>}
    </div>
  );
}

export { errorText };
