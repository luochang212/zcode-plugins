import { describe, expect, it, vi } from "vitest";
import { createEditorController } from "#excalidraw/app/editor.ts";
import type { Diagram } from "#excalidraw/contract.ts";

const doc = (id = "one", revision = 1): Diagram => ({
  id,
  revision,
  title: id,
  updatedAt: 1,
  scene: { elements: [], appState: { viewBackgroundColor: `#00000${revision}` }, files: {} },
});

describe("editor history boundaries", () => {
  it("initializes only on document changes; ignores duplicate and older revisions", async () => {
    let current = doc();
    const onScene = vi.fn();
    const editor = createEditorController({
      read: async () => current,
      commit: vi.fn(),
      onScene,
      onState: vi.fn(),
    });
    await editor.open("one");
    expect(onScene).toHaveBeenLastCalledWith(current.scene, "reset");
    current = doc("one", 2);
    await editor.open("one");
    expect(onScene).toHaveBeenLastCalledWith(current.scene, "update");
    await editor.open("one");
    current = doc();
    await editor.open("one");
    expect(onScene).toHaveBeenCalledTimes(2);
    current = doc("two");
    await editor.open("two");
    expect(onScene).toHaveBeenLastCalledWith(current.scene, "reset");
  });

  it("does not replace edits made while a document read is in flight", async () => {
    let loaded = doc();
    let finishRead: (value: Diagram) => void = () => {};
    const read = vi.fn(async () => loaded);
    const onScene = vi.fn();
    const editor = createEditorController({
      read,
      onScene,
      onState: vi.fn(),
      commit: async (input) => (loaded = { ...doc("one", 3), scene: input.scene }),
    });
    await editor.open("one");
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    );
    const refresh = editor.open("one");
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    editor.edit(doc("one", 3).scene);
    await editor.flush();
    finishRead(doc("one", 2));
    await refresh;
    expect(editor.state().document?.revision).toBe(3);
    expect(onScene).toHaveBeenCalledTimes(1);
  });

  it("keeps conflicted drafts until explicitly discarded", async () => {
    const onScene = vi.fn();
    const editor = createEditorController({
      read: async () => doc(),
      onScene,
      onState: vi.fn(),
      commit: async () => {
        throw new Error("revision_conflict");
      },
    });
    await editor.open("one");
    editor.edit(doc("one", 2).scene);
    await expect(editor.flush()).rejects.toThrow("revision_conflict");
    await expect(editor.open("one")).rejects.toThrow("revision_conflict");
    expect(editor.scene()).toEqual(doc("one", 2).scene);
    await editor.open("one", true);
    expect(editor.state().dirty).toBe(false);
    expect(onScene).toHaveBeenLastCalledWith(doc().scene, "reset");
  });
});
