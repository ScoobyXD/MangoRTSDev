import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import { downloadMangoAttachment, fetchMangoAttachmentBlob } from "../../attachments/attachmentApi.js";
import type { MentionableCompanyUser } from "../editorMentions.js";
import { MangoTiptapAnnotations, navigateMangoTiptapTarget, updateMangoTiptapAnnotations } from "../tiptap/mangoTiptapAnnotations.js";
import { createMangoTiptapExtensions, MangoAttachmentImage, type MangoAttachmentImageAttributes } from "../tiptap/mangoTiptapExtensions.js";
import type { NodeV2Client } from "./nodeV2Api.js";
import { NodeV2ProviderSyncController, type NodeV2SaveState } from "./nodeV2ProviderSync.js";
import type { NodeV2CommentThread, NodeV2TextBox } from "./nodeV2Types.js";

export type NodeV2SelectionAnchor = {
  selectedQuote: string;
  beforeText: string;
  afterText: string;
  startBase64: string;
  endBase64: string;
  status: "anchored" | "unanchored";
};

export type NodeV2InlineImage = Pick<MangoAttachmentImageAttributes, "attachmentId" | "filename" | "mimeType" | "width" | "height">;

export type NodeV2EditorHandle = {
  flush: (reason?: string) => Promise<void>;
  selectionAnchor: () => NodeV2SelectionAnchor | null;
  insertImages: (images: NodeV2InlineImage[], position?: number | null) => void;
  focusComment: (threadID: string) => boolean;
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
  comments: NodeV2CommentThread[];
  mentionUsers: MentionableCompanyUser[];
  onSaveState: (state: NodeV2SaveState) => void;
  onUploadInlineImages: (files: File[]) => Promise<NodeV2InlineImage[]>;
  onError: (message: string) => void;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function resolveNodeV2CommentAnchors(editor: Editor, document: Y.Doc, comments: readonly NodeV2CommentThread[]) {
  const binding = collaborationMapping(editor);
  if (!binding) return [];
  const fragment = document.getXmlFragment("default");
  const resolvePosition = relativePositionToAbsolutePosition as unknown as (
    ydoc: Y.Doc,
    xmlFragment: Y.XmlFragment,
    position: Y.RelativePosition,
    mapping: unknown,
  ) => number | null;
  return comments.flatMap((thread) => {
    if (thread.anchor_format !== "yjs_relative_v1" || !thread.anchor_start_base64 || !thread.anchor_end_base64) return [];
    try {
      const start = Y.decodeRelativePosition(base64ToBytes(thread.anchor_start_base64));
      const end = Y.decodeRelativePosition(base64ToBytes(thread.anchor_end_base64));
      const from = resolvePosition(document, fragment, start, binding.mapping);
      const to = resolvePosition(document, fragment, end, binding.mapping);
      if (from === null || to === null || to <= from) return [];
      return [{ id: thread.thread_id, kind: "comment" as const, from, to, durable: false as const }];
    } catch {
      return [];
    }
  });
}
function authenticatedImageExtension(apiBase: string, companyID: string, onError: (message: string) => void) {
  const ImageNodeView: React.FC<NodeViewProps> = ({ node, selected, deleteNode, editor, getPos, updateAttributes }) => {
    const [objectURL, setObjectURL] = useState("");
    const [previewOpen, setPreviewOpen] = useState(false);
    useEffect(() => {
      const controller = new AbortController();
      let created = "";
      void fetchMangoAttachmentBlob(apiBase, companyID, String(node.attrs.attachmentId), "display", { signal: controller.signal })
        .then((blob) => { created = URL.createObjectURL(blob); setObjectURL(created); })
        .catch(() => setObjectURL(""));
      return () => { controller.abort(); if (created) URL.revokeObjectURL(created); };
    }, [node.attrs.attachmentId]);
    const attachmentID = String(node.attrs.attachmentId || "");
    const filename = String(node.attrs.filename || "inline-image");
    const selectImage = () => {
      const position = typeof getPos === "function" ? getPos() : getPos;
      if (typeof position === "number") editor.commands.setNodeSelection(position);
    };
    return <NodeViewWrapper className={`node-v2-inline-image${selected ? " is-selected" : ""}`}>
      <button type="button" className="node-v2-inline-image-select" aria-label={`Select image ${filename}`} onMouseDown={(event) => { event.preventDefault(); selectImage(); }}>
        {objectURL
          ? <img src={objectURL} alt={String(node.attrs.alt || filename || "Inline attachment")} draggable={false} />
          : <span role="status">Loading image preview…</span>}
      </button>
      {selected && <div className="node-v2-inline-image-actions" contentEditable={false}>
        <button type="button" onClick={() => setPreviewOpen(true)}>Preview</button>
        <button type="button" onClick={() => void downloadMangoAttachment({ apiBase, companyID, attachmentID, filename }).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to download image"))}>Download</button>
        <button type="button" onClick={() => updateAttributes({ alignment: "left" })}>Align left</button>
        <button type="button" onClick={() => updateAttributes({ alignment: "center" })}>Align center</button>
        <button type="button" onClick={() => updateAttributes({ alignment: "right" })}>Align right</button>
        <button type="button" onClick={deleteNode}>Remove image</button>
      </div>}
      {previewOpen && objectURL && <div className="node-v2-inline-image-dialog" role="dialog" aria-modal="true" aria-label={`Image preview: ${filename}`} contentEditable={false}>
        <button type="button" aria-label="Close image preview" onClick={() => setPreviewOpen(false)}>×</button>
        <img src={objectURL} alt={String(node.attrs.alt || filename)} />
      </div>}
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
  comments,
  mentionUsers,
  onSaveState,
  onUploadInlineImages,
  onError,
}, forwardedRef) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const controllerRef = useRef<NodeV2ProviderSyncController | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const imageExtension = useMemo(() => authenticatedImageExtension(apiBase, companyID, onError), [apiBase, companyID, onError]);

  useEffect(() => {
    let disposed = false;
    const controller = new NodeV2ProviderSyncController({
      client,
      textboxID: textbox.textbox_id,
      companyID,
      nodeID,
      userID,
      collaborationEpoch: textbox.collaboration_epoch,
      onSaveState,
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
      });
      nextEditor.registerPlugin(MangoTiptapAnnotations);
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
  }, [client, textbox.textbox_id, textbox.collaboration_epoch, companyID, nodeID, userID, canEdit, imageExtension]);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!editor || !controller) return;
    updateMangoTiptapAnnotations(editor, resolveNodeV2CommentAnchors(editor, controller.document, comments));
  }, [editor, comments]);
  useImperativeHandle(forwardedRef, () => ({
    flush: async () => { await controllerRef.current?.flush(); },
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
        return { selectedQuote, beforeText, afterText, startBase64: "", endBase64: "", status: "unanchored" };
      }
    },
    insertImages: (images, position) => {
      const activeEditor = editorRef.current;
      if (!activeEditor) return;
      activeEditor.chain().focus().insertContentAt(position ?? activeEditor.state.selection.to, images.map((image) => ({ type: "mangoAttachmentImage", attrs: { ...image, displayWidth: null, displayHeight: null, alignment: "center", position: "break", layout: "content", alt: image.filename, title: image.filename } }))).run();
    },
    focusComment: (threadID) => Boolean(editorRef.current && navigateMangoTiptapTarget(editorRef.current, { annotationID: threadID })),
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
