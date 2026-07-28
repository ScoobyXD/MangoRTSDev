import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Editor } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";
import type { MentionableCompanyUser } from "../editorMentions.js";
import { openEditorEntityLink, searchEditorEntityLinks, type EditorEntityLink } from "../editorEntityLinks.js";
import type { RequestJSON } from "../NodeWorkspaceSurfaceShared.js";
import type { EditorImageAttachmentContext } from "../useEditorDocumentSurfaceHandlers.js";
import { MangoAuthenticatedImage, type MangoTiptapImageAction } from "../tiptap/MangoTiptapEditor.js";
import type { MangoStaticAttachmentImageProps } from "../tiptap/MangoTiptapStaticRenderer.js";
import { MangoTiptapAnnotations, navigateMangoTiptapTarget, updateMangoTiptapAnnotations } from "../tiptap/mangoTiptapAnnotations.js";
import { createMangoTiptapExtensions, MangoAttachmentImage, type MangoAttachmentImageAttributes } from "../tiptap/mangoTiptapExtensions.js";
import type { NodeV2Client } from "./nodeV2Api.js";
import { NodeV2ProviderSyncController, type NodeV2SaveState } from "./nodeV2ProviderSync.js";
import type { NodeV2CommentThread, NodeV2TextBox } from "./nodeV2Types.js";
import "../tiptap/mangoTiptap.css";

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
  requestJSON: RequestJSON;
  onSaveState: (state: NodeV2SaveState) => void;
  onUploadInlineImages: (files: File[]) => Promise<NodeV2InlineImage[]>;
  onImageChatRequest: (image: MangoTiptapImageAction) => void;
  onImageNodeRequest: (image: MangoTiptapImageAction) => void;
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
function authenticatedImageExtension(
  attachmentContext: EditorImageAttachmentContext,
  actions: {
    onImageChatRequest: (image: MangoTiptapImageAction) => void;
    onImageNodeRequest: (image: MangoTiptapImageAction) => void;
  },
) {
  const ImageNodeView: React.FC<NodeViewProps> = ({ node, selected, editor, getPos, updateAttributes }) => {
    const selectImage = () => {
      const position = typeof getPos === "function" ? getPos() : getPos;
      if (typeof position !== "number") return;
      (editor.view.dom as HTMLElement).focus({ preventScroll: true });
      editor.commands.setNodeSelection(position);
    };
    return (
      <NodeViewWrapper className={`node-v2-inline-image${selected ? " is-selected" : ""}`}>
        <MangoAuthenticatedImage
          attributes={node.attrs as MangoStaticAttachmentImageProps}
          attachmentContext={attachmentContext}
          selected={selected}
          editable={editor.isEditable}
          updateAttributes={updateAttributes}
          onSelect={selectImage}
          onImageChatRequest={actions.onImageChatRequest}
          onImageNodeRequest={actions.onImageNodeRequest}
        />
      </NodeViewWrapper>
    );
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
  requestJSON,
  onSaveState,
  onUploadInlineImages,
  onImageChatRequest,
  onImageNodeRequest,
  onError,
}, forwardedRef) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const controllerRef = useRef<NodeV2ProviderSyncController | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const imageActionsRef = useRef({ onImageChatRequest, onImageNodeRequest });
  imageActionsRef.current = { onImageChatRequest, onImageNodeRequest };
  const imageExtension = useMemo(() => authenticatedImageExtension({
    requestJSON: requestJSON as EditorImageAttachmentContext["requestJSON"],
    apiBase,
    companyID,
    resourceType: "node",
    resourceID: nodeID,
    informationID: textbox.textbox_id,
    editorSurface: "node_v2_textbox",
    onError: (message) => onErrorRef.current(message),
  }, {
    onImageChatRequest: (image) => imageActionsRef.current.onImageChatRequest(image),
    onImageNodeRequest: (image) => imageActionsRef.current.onImageNodeRequest(image),
  }), [apiBase, companyID, nodeID, requestJSON, textbox.textbox_id]);
  const mentionUsersRef = useRef<ReadonlyArray<{ userID: string; name: string; email?: string }>>([]);
  mentionUsersRef.current = mentionUsers.flatMap((user) => user.user_id
    ? [{ userID: user.user_id, name: user.display_name || user.email || "User", email: user.email }]
    : []);
  const uploadInlineImagesRef = useRef(onUploadInlineImages);
  uploadInlineImagesRef.current = onUploadInlineImages;

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
      const extensions = createMangoTiptapExtensions({
        editable: canEdit,
        collaboration: true,
        attachmentImageExtension: imageExtension,
        getMentionUsers: () => mentionUsersRef.current,
        searchEntityLinks: (query) => searchEditorEntityLinks({ companyID, requestJSON }, query),
        onEntityLinkSearchError: (message) => onError(message),
        onImageFiles: canEdit ? (files, position) => {
          void uploadInlineImagesRef.current(files).then((images) => {
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
          handleKeyDown: (_view, event) => {
            const entityElement = (event.target as HTMLElement | null)?.closest?.('[data-mango-entity-link="true"]') as HTMLElement | null;
            if (!entityElement || (event.key !== "Enter" && event.key !== " ")) return false;
            const entityType = entityElement.dataset.mangoEntityType;
            const entityID = entityElement.dataset.mangoEntityId?.trim() ?? "";
            const label = entityElement.dataset.mangoEntityLabel?.trim() ?? "";
            if ((entityType !== "node" && entityType !== "logic_gate" && entityType !== "project") || !entityID || !label) return false;
            event.preventDefault();
            openEditorEntityLink({ entityType, entityID, label });
            return true;
          },
          handleClickOn: (_view, _pos, node, _nodePos, event) => {
            if (node.type.name !== "mangoEntityLink") return false;
            const entityType = node.attrs.entityType;
            const entityID = typeof node.attrs.entityId === "string" ? node.attrs.entityId.trim() : "";
            const label = typeof node.attrs.label === "string" ? node.attrs.label.trim() : "";
            if ((entityType !== "node" && entityType !== "logic_gate" && entityType !== "project") || !entityID || !label) return false;
            event.preventDefault();
            openEditorEntityLink({ entityType, entityID, label } as EditorEntityLink);
            return true;
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
  }, [client, textbox.textbox_id, textbox.collaboration_epoch, companyID, nodeID, userID, canEdit, imageExtension, requestJSON]);

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
