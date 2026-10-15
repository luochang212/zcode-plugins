import { getClient } from "./client.ts";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw, MainMenu, CaptureUpdateAction, restore } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { createEditorController, type EditorState } from "#excalidraw/app/editor.ts";
import { selectionContext } from "#excalidraw/domain/scene.ts";
import type { Diagram, Scene } from "#excalidraw/contract.ts";
import { call, read, outputRef } from "#ui/bridge.ts";
import { exportDiagram } from "#ui/export.ts";
import { DocumentMenu } from "#ui/DocumentMenu.tsx";
import { ExportDialog } from "#ui/ExportDialog.tsx";
import { ReferenceContextMenu } from "#ui/ReferenceContextMenu.tsx";
import "@excalidraw/excalidraw/index.css";
import "#ui/panel.css";

const OPTIONS = {
  canvasActions: {
    loadScene: false,
    export: false as const,
    saveToActiveFile: false,
    saveAsImage: false,
    toggleTheme: false,
  },
};
function outputRefKey() {
  const ref = outputRef();
  return ref ? `${ref.id}:${ref.revision}` : "";
}
function App() {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<AppState["contextMenu"]>(null);
  const [state, setState] = useState<EditorState>({
    document: null,
    dirty: false,
    saving: false,
    error: null,
  });
  const [ready, setReady] = useState(false);
  const [globals, setGlobals] = useState({
    theme: getClient().theme,
    locale: getClient().locale,
  });
  const [documents, setDocuments] = useState<Array<Pick<Diagram, "id" | "title">>>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [operation, setOperation] = useState("");
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const importing = useRef<HTMLInputElement>(null);
  const applying = useRef(false);
  const cn = globals.locale?.startsWith("zh") ?? true;
  const t = (zh: string, en: string) => (cn ? zh : en);
  const controller = useRef<ReturnType<typeof createEditorController> | null>(null);
  if (!controller.current)
    controller.current = createEditorController({
      read,
      async commit(input) {
        const result = await call("commit_scene", input as unknown as Record<string, unknown>);
        return { ...result.document, scene: input.scene, updatedAt: Date.now() };
      },
      onScene(scene, mode) {
        const canvas = api.current;
        if (!canvas) return;
        applying.current = true;
        try {
          const reset = mode === "reset";
          const restored = restore(
            scene as any,
            reset ? null : canvas.getAppState(),
            reset ? null : canvas.getSceneElementsIncludingDeleted(),
          );
          // 同一文档的工具修改必须入普通历史；resetScene 会清空用户已有撤销记录。
          if (reset) canvas.resetScene();
          canvas.addFiles(Object.values(restored.files));
          canvas.updateScene({
            elements: restored.elements,
            appState: {
              ...(reset ? restored.appState : scene.appState),
              theme: getClient().theme === "dark" ? "dark" : "light",
            },
            captureUpdate: reset ? CaptureUpdateAction.NEVER : CaptureUpdateAction.IMMEDIATELY,
          });
          if (reset)
            canvas.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.75 });
        } finally {
          applying.current = false;
        }
      },
      onState(next) {
        setState(next);
        if (next.document && !next.dirty && !next.saving) {
          void getClient()
            .setWidgetState({ documentId: next.document.id, lastToolRef: outputRefKey() })
            .catch((e) => setOperation(String(e)));
        }
      },
    });
  const editor = controller.current;
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setOperation("");
    try {
      await action();
    } catch (e) {
      setOperation(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!ready) return;
    let active = true;
    let lastRef = "";
    let initial = true;
    const refresh = () => {
      if (!active) return;
      setGlobals({ theme: getClient().theme, locale: getClient().locale });
      // 旧结果仅用于空页面恢复；活页面不能把先到的新输入与旧导出结果拼接后误切文档。
      const ref = outputRef(!editor.state().document);
      const saved = getClient().widgetState as
        | { documentId?: string; lastToolRef?: string }
        | undefined;
      // 重开时旧 toolOutput 不能覆盖用户另选的文档；真正新增的工具结果仍优先打开。
      const restoreSelected =
        initial && saved?.documentId && (!ref || saved.lastToolRef === outputRefKey());
      initial = false;
      if (restoreSelected) {
        lastRef = outputRefKey();
        void editor.open(saved.documentId!).catch((e) => setOperation(String(e)));
        return;
      }
      if (ref && `${ref.id}:${ref.revision}` !== lastRef) {
        lastRef = `${ref.id}:${ref.revision}`;
        const current = editor.state().document;
        if (current?.id === ref.id && current.revision >= ref.revision) return;
        void editor.open(ref.id).catch((e) => setOperation(String(e)));
      } else if (!editor.state().document && !ref) {
        if (saved?.documentId)
          void editor.open(saved.documentId).catch((e) => setOperation(String(e)));
      }
    };
    window.addEventListener("plugin:change", refresh);
    refresh();
    void call("list_diagrams")
      .then((r) => {
        if (active) setDocuments(r.documents);
      })
      .catch((e) => setOperation(String(e)));
    getClient().notifyIntrinsicHeight(680);
    window.__excalidrawPanel = {
      api: api.current,
      state: editor.state,
      flush: editor.flush,
      reload: async () => {
        const d = editor.state().document;
        if (d) await editor.open(d.id);
      },
    };
    return () => {
      active = false;
      window.removeEventListener("plugin:change", refresh);
      delete window.__excalidrawPanel;
    };
  }, [ready, editor]);
  const changed = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    setSelectedCount(Object.values(appState.selectedElementIds).filter(Boolean).length);
    setContextMenu(appState.contextMenu);
    if (!applying.current) {
      try {
        editor.edit({ elements, appState, files } as unknown as Scene);
      } catch (e) {
        setOperation(String(e));
      }
    }
  };
  const newDocument = async (scene?: Scene) => {
    await editor.flush();
    const title = t("未命名画板", "Untitled diagram");
    const result = scene
      ? await call("save_copy", { title, scene })
      : await call("create_diagram", { title, elements: [] });
    await editor.open(result.document.id, true);
    setDocuments((docs) => [result.document, ...docs]);
  };
  const reference = async () => {
    // 右键先更新命中选区；等待保存前固定目标，避免旧闭包或后续选择造成引用错位。
    const id = editor.state().document?.id;
    const selectedIds = Object.entries(api.current?.getAppState().selectedElementIds ?? {})
      .filter(([, value]) => value)
      .map(([key]) => key);
    await editor.flush();
    const doc = editor.state().document;
    if (!doc || doc.id !== id)
      throw new Error(t("画板已切换，请重新引用。", "Diagram changed. Please reference it again."));
    const ids = selectedIds.length
      ? selectedIds
      : doc.scene.elements.filter((e) => !e.isDeleted).map((e) => e.id);
    const context = {
      documentId: doc.id,
      revision: doc.revision,
      elementIds: ids,
      labels: selectionContext(doc.scene, ids)
        .filter((e) => e.type === "text")
        .map((e) => String(e.text))
        .slice(0, 20),
    };
    await getClient().updateModelContext({
      content: [{ type: "text", text: `Excalidraw ${JSON.stringify(context)}` }],
      structuredContent: context,
    });
    setOperation(
      t(
        "已加入对话输入框，可继续输入修改要求。",
        "Added to the chat input. Describe your changes there.",
      ),
    );
  };
  const referenceLabel = selectedCount
    ? t(`引用选区到对话 (${selectedCount})`, `Reference selection in chat (${selectedCount})`)
    : t("引用整图到对话", "Reference diagram in chat");
  const visibleDocuments =
    state.document && !documents.some((doc) => doc.id === state.document!.id)
      ? [state.document, ...documents]
      : documents;
  return (
    <main className={`diagram-app text-ui-base ${globals.theme === "dark" ? "dark" : ""}`}>
      <header className="document-bar">
        <DocumentMenu
          title={state.document?.title ?? "Excalidraw"}
          documents={visibleDocuments}
          currentId={state.document?.id}
          busy={busy}
          referenceLabel={referenceLabel}
          t={t}
          onNew={() => void run(() => newDocument())}
          onImport={() => importing.current?.click()}
          onOpen={(id) => void run(() => editor.open(id))}
          onReference={() => void run(reference)}
        />
        <span id="save-status" className="text-ui-sm" role="status" data-error={!!state.error}>
          {state.error
            ? t("保存失败", "Save failed")
            : state.saving || state.dirty
              ? t("保存中…", "Saving…")
              : state.document
                ? t("已保存", "Saved")
                : t("未打开画板", "No diagram")}
        </span>
        <button
          id="open-export"
          disabled={!state.document || busy}
          onClick={() => setExportOpen(true)}
        >
          {t("导出", "Export")}
        </button>
        <input
          ref={importing}
          type="file"
          accept=".excalidraw,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void run(async () => newDocument(JSON.parse(await file.text())));
            event.target.value = "";
          }}
        />
      </header>
      <div className="canvas-host" ref={canvasRef}>
        <Excalidraw
          excalidrawAPI={(value: ExcalidrawImperativeAPI) => {
            api.current = value;
            setReady(true);
          }}
          onChange={changed}
          theme={globals.theme === "dark" ? "dark" : "light"}
          langCode={cn ? "zh-CN" : "en"}
          UIOptions={OPTIONS}
          aiEnabled={false}
          validateEmbeddable={false}
          handleKeyboardGlobally={false}
          viewModeEnabled={!state.document}
        >
          <MainMenu>
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.DefaultItems.Help />
          </MainMenu>
        </Excalidraw>
        <ReferenceContextMenu
          canvasRef={canvasRef}
          menu={contextMenu}
          label={referenceLabel}
          disabled={!state.document || busy}
          onSelect={() => {
            void run(reference);
            api.current?.updateScene({
              appState: { contextMenu: null },
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            canvasRef.current?.querySelector<HTMLElement>(".excalidraw")?.focus();
          }}
        />
      </div>
      {(state.error || operation) && (
        <div className="notice text-ui-sm" role="status" id="operation-status">
          <span>{state.error || operation}</span>
          {state.error ? (
            <div className="notice-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const result = await call("save_copy", {
                      title: `${state.document?.title} ${t("副本", "copy")}`,
                      scene: editor.scene(),
                    });
                    await editor.open(result.document.id, true);
                    setDocuments((docs) => [result.document, ...docs]);
                  })
                }
              >
                {t("保存副本", "Save a copy")}
              </button>
              <button
                disabled={busy}
                onClick={() => void run(() => editor.open(state.document!.id, true))}
              >
                {t("放弃草稿并重载", "Discard draft and reload")}
              </button>
            </div>
          ) : (
            <button aria-label={t("关闭提示", "Dismiss message")} onClick={() => setOperation("")}>
              ×
            </button>
          )}
        </div>
      )}
      {exportOpen && state.document && (
        <ExportDialog
          title={state.document.title}
          t={t}
          onClose={() => setExportOpen(false)}
          onExport={async (format, path, overwrite) => {
            const documentId = state.document!.id;
            await editor.flush();
            const current = editor.state().document;
            if (!current || current.id !== documentId)
              throw new Error(
                t("画板已切换，请重新导出。", "Diagram changed. Please export again."),
              );
            const output = await exportDiagram(api.current!, current, format, path, overwrite);
            setOperation(`${t("已导出", "Exported")}: ${output}`);
            return output;
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
