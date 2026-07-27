import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Editor, type JSONContent } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { absolutePositionToRelativePosition, yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { fetchMangoAttachmentBlob } from "../../attachments/attachmentApi.js";
import type { MentionableCompanyUser } from "../editorMentions.js";
import { createMangoTiptapExtensions, MangoAttachmentImage, type MangoAttachmentImageAttributes } from "../tiptap/mangoTiptapExtensions.js";
import type { NodeV2Client } from "./nodeV2Api.js";
import { NodeV2SyncController, type NodeV2SaveState } from "./nodeV2Sync.js";
import type { NodeV2TextBox } from "./nodeV2Types.js";

export type NodeV2SelectionAnchor = {
  selectedQuote: string;
  beforeText: string;
  afterText: string;
  startBase64: string;
  endBase64: string;
  status: "anchored" | "legacy_unanchored";
};

export type NodeV2InlineImage = Pick<MangoAttachmentImageAttributes, "attachmentId" | "filename" | "mimeType" | "width" | "height">;

export type NodeV2EditorHandle = {
  flush: (reason?: string) => Promise<void>;
  selectionAnchor: () => NodeV2SelectionAnchor | null;
  insertImages: (images: NodeV2InlineImage[], position?: number | null) => void;
  focus: () => void;
};

type Props = {
  apiBase: string;
  companyID: string;
  nodeID: string;
  userID: string;
  textbox: NodeV2TextBox;
  client: NodeV2Client;
  canEdit: boolean;
  mentionUsers: MentionableCompanyUser[];
  onSaveState: (state: NodeV2SaveState) => void;
  onDocumentChange: (document: JSONContent, plainText: string) => void;
  onUploadInlineImages: (files: File[]) => Promise<NodeV2InlineImage[]>;
  onError: (message: string) => void;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function authenticatedImageExtension(apiBase: string, companyID: string) {
  const ImageNodeView: React.FC<NodeViewProps> = ({ node, selected }) => {
    const [objectURL, setObjectURL] = useState("");
    useEffect(() => {
      const controller = new AbortController();
      let created = "";
      void fetchMangoAttachmentBlob(apiBase, companyID, String(node.attrs.attachmentId), "display", { signal: controller.signal })
        .then((blob) => { created = URL.createObjectURL(blob); setObjectURL(created); })
        .catch(() => setObjectURL(""));
      return () => { controller.abort(); if (created) URL.revokeObjectURL(created); };
    }, [node.attrs.attachmentId]);
    return <NodeViewWrapper className={`node-v2-inline-image${selected ? " is-selected" : ""}`}>
      {objectURL
        ? <img src={objectURL} alt={String(node.attrs.alt || node.attrs.filename || "Inline attachment")} draggable={false} />
        : <span role="status">Loading image preview…</span>}
    </NodeViewWrapper>;
  };
  return MangoAttachmentImage.extend({
    addNodeView() {
      return ReactNodeViewRenderer(ImageNodeView);
    },
  });
}

function collaborationMapping(editor: Editor): { mapping: unknown } | null {
  for (const plugin of editor.state.plugins) {
    const state = plugin.getState(editor.state) as { binding?: { mapping?: unknown } } | undefined;
    if (state?.binding?.mapping) return { mapping: state.binding.mapping };
  }
  return null;
}

export const NodeV2Editor = forwardRef<NodeV2EditorHandle, Props>(function NodeV2Editor({
  apiBase,
  companyID,
  nodeID,
  userID,
  textbox,
  client,
  canEdit,
  mentionUsers,
  onSaveState,
  onDocumentChange,
  onUploadInlineImages,
  onError,
}, forwardedRef) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const controllerRef = useRef<NodeV2SyncController | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const checkpointRequestedRef = useRef(false);
  const imageExtension = useMemo(() => authenticatedImageExtension(apiBase, companyID), [apiBase, companyID]);

  const checkpoint = async (reason: string) => {
    const activeEditor = editorRef.current;
    const controller = controllerRef.current;
    if (!activeEditor || !controller) return;
    await controller.checkpoint(activeEditor.getJSON() as Record<string, unknown>, activeEditor.getText({ blockSeparator: "\n" }), reason);
    onDocumentChange(activeEditor.getJSON(), activeEditor.getText({ blockSeparator: "\n" }));
  };

  useEffect(() => {
    let disposed = false;
    const controller = new NodeV2SyncController({
      client,
      textboxID: textbox.textbox_id,
      companyID,
      nodeID,
      userID,
      onSaveState,
      onCheckpointNeeded: () => {
        if (checkpointRequestedRef.current) return;
        checkpointRequestedRef.current = true;
        queueMicrotask(() => {
          checkpointRequestedRef.current = false;
          void checkpoint("idle").catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to save the text box"));
        });
      },
      onError,
    });
    controllerRef.current = controller;
    void controller.start().then(() => {
      if (disposed) return;
      const normalizedUsers = mentionUsers.flatMap((user) => user.user_id ? [{ userID: user.user_id, name: user.display_name || user.email || "User", email: user.email }] : []);
      const extensions = createMangoTiptapExtensions({
        editable: canEdit,
        collaboration: true,
        attachmentImageExtension: imageExtension,
        mentionUsers: normalizedUsers,
        onImageFiles: canEdit ? (files, position) => {
          void onUploadInlineImages(files).then((images) => {
            editorRef.current?.chain().focus().insertContentAt(position ?? editorRef.current.state.selection.to, images.map((image) => ({ type: "mangoAttachmentImage", attrs: { ...image, displayWidth: null, displayHeight: null, alignment: "center", position: "break", layout: "content", alt: image.filename, title: image.filename } }))).run();
          }).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to upload inline image"));
        } : undefined,
      });
      extensions.push(Collaboration.configure({
        document: controller.document,
        field: "default",
        onFirstRender: () => {
          queueMicrotask(() => {
            const undoManager = editorRef.current ? yUndoPluginKey.getState(editorRef.current.state)?.undoManager : undefined;
            undoManager?.clear();
            undoManager?.stopCapturing();
          });
        },
      }));
      const nextEditor = new Editor({
        extensions,
        editable: canEdit,
        editorProps: {
          attributes: {
            class: "mango-tiptap-prosemirror node-v2-prosemirror",
            role: "textbox",
            "aria-label": "Node text box",
            "aria-multiline": "true",
          },
        },
        onBlur: () => { void checkpoint("blur").catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to save the text box")); },
      });
      editorRef.current = nextEditor;
      setEditor(nextEditor);
    }).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to recover the text box"));
    return () => {
      disposed = true;
      const activeEditor = editorRef.current;
      editorRef.current = null;
      activeEditor?.destroy();
      setEditor(null);
      const activeController = controllerRef.current;
      controllerRef.current = null;
      if (activeController) void activeController.stop();
    };
  }, [client, textbox.textbox_id, companyID, nodeID, userID, canEdit, imageExtension]);

  useImperativeHandle(forwardedRef, () => ({
    flush: async (reason = "manual") => checkpoint(reason),
    selectionAnchor: () => {
      const activeEditor = editorRef.current;
      const controller = controllerRef.current;
      if (!activeEditor || !controller) return null;
      const { from, to } = activeEditor.state.selection;
      if (from === to) return null;
      const selectedQuote = activeEditor.state.doc.textBetween(from, to, "\n").trim();
      if (!selectedQuote) return null;
      const beforeText = activeEditor.state.doc.textBetween(Math.max(0, from - 80), from, "\n");
      const afterText = activeEditor.state.doc.textBetween(to, Math.min(activeEditor.state.doc.content.size, to + 80), "\n");
      try {
        const binding = collaborationMapping(activeEditor);
        if (!binding) throw new Error("No collaboration mapping");
        const fragment = controller.document.getXmlFragment("default");
        const start = absolutePositionToRelativePosition(from, fragment, binding.mapping as never);
        const end = absolutePositionToRelativePosition(to, fragment, binding.mapping as never);
        return { selectedQuote, beforeText, afterText, startBase64: bytesToBase64(Y.encodeRelativePosition(start)), endBase64: bytesToBase64(Y.encodeRelativePosition(end)), status: "anchored" };
      } catch {
        return { selectedQuote, beforeText, afterText, startBase64: "", endBase64: "", status: "legacy_unanchored" };
      }
    },
    insertImages: (images, position) => {
      const activeEditor = editorRef.current;
      if (!activeEditor) return;
      activeEditor.chain().focus().insertContentAt(position ?? activeEditor.state.selection.to, images.map((image) => ({ type: "mangoAttachmentImage", attrs: { ...image, displayWidth: null, displayHeight: null, alignment: "center", position: "break", layout: "content", alt: image.filename, title: image.filename } }))).run();
    },
    focus: () => editorRef.current?.commands.focus(),
  }));

  if (!editor) return <div className="node-v2-editor-loading" role="status">Recovering this text box…</div>;
  return <div className="node-v2-editor-shell">
    <div className="node-v2-editor-toolbar" role="toolbar" aria-label="Text box editing">
      <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} aria-pressed={editor.isActive("bold")}>Bold</button>
      <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} aria-pressed={editor.isActive("italic")}>Italic</button>
      <button type="button" onClick={() => editor.commands.undo()} disabled={!canEdit}>Undo</button>
      <button type="button" onClick={() => editor.commands.redo()} disabled={!canEdit}>Redo</button>
    </div>
    <EditorContent editor={editor} />
  </div>;
});
