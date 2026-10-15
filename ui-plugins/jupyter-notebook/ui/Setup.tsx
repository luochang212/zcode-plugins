import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { MissingJupyterDetails, NotebookRef, ServerInfo, SessionState } from "#nb/contract.ts";
import { host, ToolError } from "#ui/bridge.ts";
import type { Strings } from "#ui/i18n.ts";
import { Icon } from "#ui/icons.tsx";
import { Menu, MenuItem, useMenu } from "#ui/Menu.tsx";
import { refreshState, selectNotebook } from "#ui/store.ts";
import { hostOf, relativeTime } from "#ui/text.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 没有 notebook 时页面的头部：只有标题，可选关闭。 */
function PlainHeader({ title, s, onClose, children }: { title: string; s: Strings; onClose?: () => void; children?: ReactNode }) {
  return (
    <header className="hdr">
      <div className="title">
        <Icon name="notebook" />
        <span className="name">{title}</span>
      </div>
      <span className="spacer" />
      {children}
      {onClose && (
        <button type="button" className="btn ghost icon-only quiet" aria-label={s.close} title={s.close} onClick={onClose}>
          <Icon name="x" />
        </button>
      )}
    </header>
  );
}

/** 没有已连接 server 时：本机发现的 server、为工作区启动、按 URL 连接。 */
export function ServerSetup({ state, s }: { state: SessionState; s: Strings }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<MissingJupyterDetails | null>(null);
  const [byUrl, setByUrl] = useState(false);
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const discovered = state.discovered.filter((item) => !item.connectedAs);
  const starting = busy === "start" || busy === "uv" || state.servers.some((server) => server.status === "starting");
  const failed = state.servers.find((server) => server.status === "error");

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await action();
      setMissing(null);
      await refreshState();
    } catch (caught) {
      if (caught instanceof ToolError && caught.code === "jupyter_not_installed" && caught.details)
        setMissing(caught.details as unknown as MissingJupyterDetails);
      else setError(message(caught));
    } finally {
      setBusy(null);
    }
  };
  const start = (useUv = false) => run(useUv ? "uv" : "start", () => host.call("start_server", useUv ? { useUv: true } : {}));

  if (missing)
    return (
      <div className="shell">
        <PlainHeader title={s.title} s={s} />
        <div className="page">
          <MissingJupyter
            details={missing}
            s={s}
            busy={busy}
            error={error}
            onRetry={() => void start()}
            onUv={() => void start(true)}
            onBack={() => (setMissing(null), setError(null))}
          />
        </div>
      </div>
    );

  return (
    <div className="shell">
      <PlainHeader title={s.title} s={s} />
      <div className="page">
        <div className="setup">
          <div className="intro">
            <div className="tile lg">
              <Icon name="notebook" size={20} />
            </div>
            <h1>{s.setupTitle}</h1>
            <p className="lead">{s.setupBody}</p>
          </div>

          {discovered.length > 0 && (
            <div className="section">
              <div className="label">{s.discovered}</div>
              <div className="card">
                {discovered.map((item) => (
                  <div className="row" key={item.url}>
                    <div className="tile">
                      <Icon name="server" />
                    </div>
                    <div className="grow">
                      <div className="mono sm" style={{ fontSize: "var(--nb-text-caption)", lineHeight: "20px" }}>
                        {hostOf(item.url)}
                      </div>
                      <div className="sm fg2" title={item.rootDir ?? undefined}>
                        {[item.version && s.serverVersion(item.version), item.rootDir].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn outline"
                      disabled={!!busy}
                      onClick={() => void run(item.url, () => host.call("connect_server", { url: item.url }))}
                    >
                      {busy === item.url ? s.connectingServer : s.connect}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="section">
            <div className="label">{discovered.length ? s.startLabelOr : s.startLabel}</div>
            <div className="card">
              <div className="row start">
                <div className="grow">
                  <div className="strong">{s.startTitle}</div>
                  <div className="sm fg2" style={{ marginTop: 2 }}>
                    {s.startDetail(state.launchPython)}
                  </div>
                </div>
                <button type="button" className="btn primary" disabled={!!busy || starting} onClick={() => void start()}>
                  {starting && <Icon name="spinner" size={14} className="spin" />}
                  {starting ? s.starting : s.start}
                </button>
              </div>
            </div>
          </div>

          <div className="section">
            <button type="button" className={`label ${byUrl ? "open" : ""}`} aria-expanded={byUrl} onClick={() => setByUrl(!byUrl)}>
              <Icon name="chevronDown" size={12} />
              {s.byUrl}
            </button>
            {byUrl && (
              <form
                className="url-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (url.trim())
                    void run("url", () =>
                      host.call("connect_server", { url: url.trim(), ...(token.trim() ? { token: token.trim() } : {}) }),
                    );
                }}
              >
                <label className="field mono">
                  <Icon name="link" size={14} />
                  <input
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder={s.urlPlaceholder}
                    spellCheck={false}
                    aria-label={s.byUrl}
                  />
                </label>
                <div className="line">
                  <label className="field">
                    <input
                      value={token}
                      onChange={(event) => setToken(event.target.value)}
                      placeholder={s.tokenPlaceholder}
                      type="password"
                      autoComplete="off"
                      aria-label={s.tokenPlaceholder}
                    />
                  </label>
                  <button type="submit" className="btn outline size-lg" disabled={!!busy || !url.trim()}>
                    {busy === "url" ? s.connectingServer : s.connect}
                  </button>
                </div>
              </form>
            )}
          </div>

          {(error || failed?.error) && <pre className="error-box">{error ?? `${s.serverStopped}\n${failed?.error}`}</pre>}
          <p className="hint">{s.askAgent}</p>
        </div>
      </div>
    </div>
  );
}

function MissingJupyter({
  details,
  s,
  busy,
  error,
  onRetry,
  onUv,
  onBack,
}: {
  details: MissingJupyterDetails;
  s: Strings;
  busy: string | null;
  error: string | null;
  onRetry: () => void;
  onUv: () => void;
  onBack: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const command = useRef<HTMLElement>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details.installCommand);
    } catch {
      // 沙箱 iframe 可能不允许写剪贴板：选中命令，用户自己复制。
      const range = document.createRange();
      if (command.current) range.selectNodeContents(command.current);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const [lead, pkg1, and, pkg2, tail] = s.missingBody;
  return (
    <div className="setup" style={{ gap: 20 }}>
      <div className="intro">
        <div className="tile lg warn">
          <Icon name="alert" size={20} />
        </div>
        <h1>{s.missingTitle}</h1>
        <p className="lead">
          {lead}
          <code>{pkg1}</code>
          {and}
          <code>{pkg2}</code>
          {tail}
        </p>
      </div>
      {details.pythons.length > 0 && (
        <div className="card">
          {details.pythons.map((python) => (
            <div className="row compact" key={python.executable}>
              <span className="mono name" style={{ fontSize: "var(--nb-text-caption)" }}>
                {python.executable}
              </span>
              <span className="side">
                {python.version === null
                  ? s.notFound
                  : `${python.version} · ${python.missing.length > 1 ? s.missingBoth : s.missingOne(python.missing[0] ?? "")}`}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="section">
        <div className="label">{s.installLabel}</div>
        <div className="cmd">
          <code ref={command}>{details.installCommand}</code>
          <button type="button" className="btn sm ghost icon-only quiet" aria-label={s.copy} title={copied ? s.copied : s.copy} onClick={() => void copy()}>
            <Icon name={copied ? "check" : "copy"} size={14} />
          </button>
        </div>
      </div>
      <div className="buttons">
        <button type="button" className="btn primary" disabled={!!busy} onClick={onRetry}>
          {busy === "start" && <Icon name="spinner" size={14} className="spin" />}
          {busy === "start" ? s.starting : s.tryAgain}
        </button>
        <button type="button" className="btn outline" disabled={!!busy} onClick={onUv}>
          {busy === "uv" && <Icon name="spinner" size={14} className="spin" />}
          {busy === "uv" ? s.starting : s.useUv}
        </button>
        <span className="spacer" />
        <button type="button" className="btn ghost quiet" disabled={!!busy} onClick={onBack}>
          {s.back}
        </button>
      </div>
      <p className="hint" style={{ marginTop: -8 }}>
        {s.uvHint}
      </p>
      {error && <pre className="error-box">{error}</pre>}
    </div>
  );
}

interface Entry {
  name: string;
  path: string;
  type: string;
  lastModified: string;
}

/** 浏览 server 目录，打开或新建 notebook。 */
export function NotebookPicker({
  state,
  s,
  initialCreate = false,
  onClose,
}: {
  state: SessionState;
  s: Strings;
  initialCreate?: boolean;
  onClose?: () => void;
}) {
  const ready = state.servers.filter((server) => server.status === "ready");
  const [serverId, setServerId] = useState(ready[0]?.id ?? "");
  const [dir, setDir] = useState("");
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(initialCreate);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const serverMenu = useMenu();
  const server: ServerInfo | undefined = ready.find((item) => item.id === serverId) ?? ready[0];
  const now = Date.now();

  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    setEntries(null);
    host.call<{ entries: Entry[] }>("list_notebooks", { server: server.id, path: dir }).then(
      (result) => !cancelled && setEntries(result.entries),
      (caught) => {
        if (cancelled) return;
        setEntries([]);
        setError(message(caught));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [server?.id, dir]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (entries ?? []).filter((entry) => !needle || entry.name.toLowerCase().includes(needle));
  }, [entries, query]);

  const open = async (path: string, create = false) => {
    if (!server) return;
    setBusy(true);
    setError(null);
    try {
      const result = await host.call<{ notebook: NotebookRef }>("open_notebook", { server: server.id, path, create });
      selectNotebook(result.notebook.notebookId);
      await refreshState();
      onClose?.();
    } catch (caught) {
      setError(message(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = () => {
    let file = name.trim() || s.newPlaceholder;
    if (!file.toLowerCase().endsWith(".ipynb")) file += ".ipynb";
    void open(dir ? `${dir}/${file}` : file, true);
  };

  if (!server) return null;
  const openIds = new Map(state.notebooks.filter((nb) => nb.serverId === server.id).map((nb) => [nb.path, nb]));
  const rootLabel = server.rootDir ? server.rootDir.replace(/\/+$/, "").split("/").pop() || server.rootDir : hostOf(server.url);
  const parts = dir ? dir.split("/") : [];

  return (
    <div className="shell">
      <PlainHeader title={s.openTitle} s={s} onClose={onClose}>
        <div className="anchor" ref={serverMenu.root} style={{ position: "relative" }}>
          {ready.length > 1 ? (
            <button
              type="button"
              ref={serverMenu.anchor}
              className={`chip ${serverMenu.open ? "open" : ""}`}
              aria-haspopup="menu"
              aria-label={s.server}
              onClick={serverMenu.toggle}
            >
              <span className="lamp ok" />
              <span className="mono" style={{ fontSize: "var(--nb-text-sm)" }}>
                {server.id}
              </span>
              <Icon name="chevronDown" size={14} className="chev" />
            </button>
          ) : (
            <span className="chip" title={server.url}>
              <span className="lamp ok" />
              <span className="mono" style={{ fontSize: "var(--nb-text-sm)" }}>
                {server.id}
              </span>
            </span>
          )}
          {serverMenu.open && (
            <Menu onClose={serverMenu.close} align="right" label={s.server}>
              {ready.map((item) => (
                <MenuItem
                  key={item.id}
                  checked={item.id === server.id}
                  label={<span className="mono">{item.id}</span>}
                  onSelect={() => {
                    serverMenu.close();
                    setServerId(item.id);
                    setDir("");
                  }}
                />
              ))}
            </Menu>
          )}
        </div>
      </PlainHeader>
      <div className="page">
        <div className="picker">
          {creating ? (
            <form
              className="top"
              onSubmit={(event) => {
                event.preventDefault();
                create();
              }}
            >
              <label className="field">
                <Icon name="notebook" size={14} />
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={s.newPlaceholder}
                  spellCheck={false}
                  aria-label={s.newNotebook}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setCreating(false);
                  }}
                />
              </label>
              <button type="submit" className="btn primary size-lg" disabled={busy}>
                {s.create}
              </button>
              <button type="button" className="btn ghost quiet size-lg" onClick={() => setCreating(false)}>
                {s.cancel}
              </button>
            </form>
          ) : (
            <div className="top">
              <label className="field">
                <Icon name="search" size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={s.find} aria-label={s.find} />
              </label>
              <button type="button" className="btn outline size-lg" onClick={() => setCreating(true)}>
                <Icon name="plus" size={15} />
                {s.newNotebook}
              </button>
            </div>
          )}
          <nav className="crumbs" aria-label="Path">
            <button type="button" title={server.rootDir ?? undefined} onClick={() => setDir("")}>
              {rootLabel}
            </button>
            {parts.map((part, index) => (
              <span key={index} style={{ display: "contents" }}>
                <Icon name="chevronRight" size={12} />
                <button type="button" onClick={() => setDir(parts.slice(0, index + 1).join("/"))}>
                  {part}
                </button>
              </span>
            ))}
          </nav>
          <div className="card">
            {entries === null && <div className="row compact placeholder">{s.loading}</div>}
            {entries !== null && shown.length === 0 && (
              <div className="row compact placeholder">{query.trim() ? s.noMatch : s.emptyDir}</div>
            )}
            {shown.map((entry) => {
              const isDir = entry.type === "directory";
              const openNb = openIds.get(entry.path);
              const modified = Date.parse(entry.lastModified);
              return (
                <button
                  type="button"
                  key={entry.path}
                  className="row compact file"
                  disabled={busy}
                  onClick={() => (isDir ? (setDir(entry.path), setQuery("")) : void open(entry.path))}
                >
                  <Icon name={isDir ? "folder" : "notebook"} />
                  <span className="name">{entry.name}</span>
                  {!isDir && (
                    <span className="side">
                      {openNb && <span className="lamp ok" />}
                      {[openNb ? s.openNow : null, Number.isFinite(modified) ? relativeTime(modified, now, s) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {error && <pre className="error-box">{error}</pre>}
        </div>
      </div>
    </div>
  );
}
