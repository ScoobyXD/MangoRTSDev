import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchMangoAttachmentBlob, uploadMangoAttachment, type AttachmentRequestJSON, type MangoAttachment } from "../../attachments/attachmentApi.js";
import { sanitizeEditorDocumentHTML } from "../richTextEditing.js";
import { MangoTiptapStaticRenderer } from "../tiptap/MangoTiptapStaticRenderer.js";
import type { MentionableCompanyUser, NodeWorkspaceSaveController, RequestJSON } from "../NodeWorkspaceSurfaceShared.js";
import { createNodeV2Client } from "./nodeV2Api.js";
import { NodeV2Editor, type NodeV2EditorHandle, type NodeV2InlineImage } from "./NodeV2Editor.js";
import type { NodeV2SaveState } from "./nodeV2Sync.js";
import type { NodeV2AttachmentLink, NodeV2CommentThread, NodeV2Cursor, NodeV2EmailMessage, NodeV2TextBox, NodeV2TextBoxSummary, NodeV2TimelineItem, NodeV2Workspace } from "./nodeV2Types.js";
import "./nodeV2.css";

type Props = {
  apiBase: string;
  companyID: string;
  nodeID: string;
  currentUserID: string;
  canEdit: boolean;
  companyUsers: MentionableCompanyUser[];
  hidden?: boolean;
  topPx: number;
  requestJSON: RequestJSON;
  onRegisterSaveController?: (controller: NodeWorkspaceSaveController | null) => void;
  onError: (message: string) => void;
};

function randomID(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cursorKey(cursor?: NodeV2Cursor): string {
  return cursor ? `${cursor.timestamp}:${cursor.id}:${cursor.sequence ?? 0}` : "";
}

function readableBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function timelineLabel(item: NodeV2TimelineItem): string {
  switch (item.item_type) {
    case "textbox_created": return "Text box created";
    case "node_moved": return "Node moved";
    case "verification_stamp": return "Verification stamp";
  }
}

function saveLabel(state: NodeV2SaveState): string {
  switch (state) {
    case "loading": return "Recovering…";
    case "saving": return "Saving…";
    case "offline": return "Offline — saved on this device";
    case "error": return "Retrying save…";
    default: return "Saved";
  }
}

const AttachmentPreview: React.FC<{ apiBase: string; companyID: string; attachment: MangoAttachment; alt?: string }> = ({ apiBase, companyID, attachment, alt }) => {
  const [url, setURL] = useState("");
  useEffect(() => {
    if (!attachment.mime_type.startsWith("image/")) return undefined;
    const controller = new AbortController();
    let created = "";
    void fetchMangoAttachmentBlob(apiBase, companyID, attachment.attachment_id, "thumbnail", { signal: controller.signal })
      .then((blob) => { created = URL.createObjectURL(blob); setURL(created); })
      .catch(() => setURL(""));
    return () => { controller.abort(); if (created) URL.revokeObjectURL(created); };
  }, [apiBase, companyID, attachment.attachment_id, attachment.mime_type]);
  if (!attachment.mime_type.startsWith("image/")) return <span className="node-v2-file-icon" aria-hidden="true">FILE</span>;
  return url ? <img className="node-v2-attachment-preview" src={url} alt={alt ?? attachment.original_filename} loading="lazy" /> : <span role="status">Preview loading…</span>;
};

const StaticAttachmentImage: React.FC<{ apiBase: string; companyID: string; attachmentID: string; filename: string }> = ({ apiBase, companyID, attachmentID, filename }) => {
  const [url, setURL] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let created = "";
    void fetchMangoAttachmentBlob(apiBase, companyID, attachmentID, "display", { signal: controller.signal })
      .then((blob) => { created = URL.createObjectURL(blob); setURL(created); })
      .catch(() => setURL(""));
    return () => { controller.abort(); if (created) URL.revokeObjectURL(created); };
  }, [apiBase, companyID, attachmentID]);
  return url ? <img className="node-v2-static-image" src={url} alt={filename} loading="lazy" /> : <span>Image preview unavailable</span>;
};

const VirtualStaticTextbox: React.FC<{ apiBase: string; companyID: string; textbox: NodeV2TextBoxSummary; client: ReturnType<typeof createNodeV2Client>; onActivate: () => void }> = ({ apiBase, companyID, textbox, client, onActivate }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [document, setDocument] = useState<NodeV2TextBox>();
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") { setVisible(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setVisible(true);
    }, { rootMargin: "600px 0px" });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || document) return;
    let cancelled = false;
    void client.textbox(textbox.textbox_id).then((item) => {
      if (!cancelled) setDocument(item);
    });
    return () => { cancelled = true; };
  }, [visible, document, client, textbox.textbox_id]);
  return <div ref={rootRef} className="node-v2-static-document" onDoubleClick={onActivate} data-testid="node-v2-static-textbox">
    {document
      ? <MangoTiptapStaticRenderer
        value={document.document_json}
        ariaLabel="Inactive Node text box"
        renderAttachmentImage={(attributes) => <StaticAttachmentImage apiBase={apiBase} companyID={companyID} attachmentID={attributes.attachmentId} filename={attributes.filename} />}
      />
      : <div className="node-v2-virtual-placeholder" aria-label={visible ? "Loading text box" : "Text box not yet loaded"} />}
  </div>;
};

const ThreadReply: React.FC<{ disabled: boolean; onReply: (body: string) => Promise<void> }> = ({ disabled, onReply }) => {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  return <form className="node-v2-reply" onSubmit={(event) => {
    event.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    void onReply(body.trim()).then(() => setBody("")).finally(() => setSending(false));
  }}>
    <label><span className="node-v2-visually-hidden">Reply</span><input value={body} onChange={(event) => setBody(event.target.value)} placeholder="Reply" disabled={disabled || sending} /></label>
    <button type="submit" disabled={disabled || sending || !body.trim()}>Reply</button>
  </form>;
};

export const NodeV2WorkspaceSurface: React.FC<Props> = ({
  apiBase,
  companyID,
  nodeID,
  currentUserID,
  canEdit,
  companyUsers,
  hidden,
  topPx,
  requestJSON,
  onRegisterSaveController,
  onError,
}) => {
  const client = useMemo(() => createNodeV2Client(requestJSON, companyID, nodeID), [requestJSON, companyID, nodeID]);
  const editorRef = useRef<NodeV2EditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [workspace, setWorkspace] = useState<NodeV2Workspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTextboxID, setActiveTextboxID] = useState("");
  const [saveState, setSaveState] = useState<NodeV2SaveState>("loading");
  const [panel, setPanel] = useState<"comments" | "files" | "emails" | "timeline">("comments");
  const [comments, setComments] = useState<NodeV2CommentThread[]>([]);
  const [commentCursor, setCommentCursor] = useState<NodeV2Cursor>();
  const [commentBody, setCommentBody] = useState("");
  const [mentionUserID, setMentionUserID] = useState("");
  const [emailMessages, setEmailMessages] = useState<Record<string, { items: NodeV2EmailMessage[]; nextCursor?: NodeV2Cursor }>>({});
  const [documents, setDocuments] = useState<Record<string, NodeV2TextBox>>({});
  const [busy, setBusy] = useState(false);

  const hydrateTextbox = useCallback(async (textboxID: string) => {
    if (documents[textboxID]) return documents[textboxID];
    const document = await client.textbox(textboxID);
    setDocuments((current) => ({ ...current, [textboxID]: document }));
    return document;
  }, [client, documents]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await client.workspace(30);
      setWorkspace(next);
      setActiveTextboxID((current) => next.textboxes.some((item) => item.textbox_id === current) ? current : next.textboxes[0]?.textbox_id ?? "");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to load Node v2");
    } finally {
      setLoading(false);
    }
  }, [client, onError]);

  useEffect(() => { void reload(); }, [reload]);

  useEffect(() => {
    if (!activeTextboxID) return;
    void hydrateTextbox(activeTextboxID).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to load the text box"));
  }, [activeTextboxID, hydrateTextbox, onError]);

  useEffect(() => {
    onRegisterSaveController?.({ flushPendingProjectionSaves: async () => { await editorRef.current?.flush("navigation"); } });
    return () => onRegisterSaveController?.(null);
  }, [onRegisterSaveController]);

  useEffect(() => {
    if (!activeTextboxID) { setComments([]); setCommentCursor(undefined); return; }
    let cancelled = false;
    void client.comments(activeTextboxID).then((page) => {
      if (!cancelled) { setComments(page.threads ?? []); setCommentCursor(page.next_cursor); }
    }).catch((cause) => { if (!cancelled) onError(cause instanceof Error ? cause.message : "Unable to load comments"); });
    return () => { cancelled = true; };
  }, [client, activeTextboxID, onError]);

  const activate = async (textboxID: string) => {
    if (textboxID === activeTextboxID) return;
    try {
      await editorRef.current?.flush("switch_textbox");
      await hydrateTextbox(textboxID);
      setActiveTextboxID(textboxID);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "The current text box could not be saved");
    }
  };

  const createTextbox = async () => {
    setBusy(true);
    try {
      await editorRef.current?.flush("create_textbox");
      const result = await client.createTextbox(randomID());
      setDocuments((current) => ({ ...current, [result.textbox.textbox_id]: result.textbox }));
      setWorkspace((current) => current ? {
        ...current,
        textboxes: [result.textbox, ...current.textboxes],
        timeline: { ...current.timeline, items: [result.timeline_item, ...current.timeline.items] },
        counts: { ...current.counts, textboxes: current.counts.textboxes + 1 },
      } : current);
      setActiveTextboxID(result.textbox.textbox_id);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to create a text box");
    } finally {
      setBusy(false);
    }
  };

  const archiveTextbox = async (textbox: NodeV2TextBoxSummary, archived: boolean) => {
    setBusy(true);
    try {
      if (textbox.textbox_id === activeTextboxID) await editorRef.current?.flush("archive");
      const updated = await client.archiveTextbox(textbox.textbox_id, archived, randomID());
      setWorkspace((current) => {
        if (!current) return current;
        const active = current.textboxes.filter((item) => item.textbox_id !== textbox.textbox_id);
        const archivedItems = current.archived_textboxes.filter((item) => item.textbox_id !== textbox.textbox_id);
        if (archived) archivedItems.unshift(updated); else active.unshift(updated);
        return { ...current, textboxes: active, archived_textboxes: archivedItems, counts: { ...current.counts, textboxes: active.length, archived_textboxes: archivedItems.length } };
      });
      if (archived && textbox.textbox_id === activeTextboxID) setActiveTextboxID(workspace?.textboxes.find((item) => item.textbox_id !== textbox.textbox_id)?.textbox_id ?? "");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to update the text box");
    } finally {
      setBusy(false);
    }
  };

  const moveTextbox = async (index: number, direction: -1 | 1) => {
    if (!workspace) return;
    const target = index + direction;
    if (target < 0 || target >= workspace.textboxes.length) return;
    const next = [...workspace.textboxes];
    [next[index], next[target]] = [next[target], next[index]];
    setWorkspace({ ...workspace, textboxes: next });
    try {
      const result = await client.moveTextbox(workspace.textboxes[index].textbox_id, workspace.textboxes[target].textbox_id, direction < 0 ? "before" : "after", randomID());
      setWorkspace((current) => current ? { ...current, textboxes: current.textboxes.map((item) => item.textbox_id === result.textbox_id ? { ...item, display_order: result.display_order } : item) } : current);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to reorder text boxes");
      await reload();
    }
  };

  const uploadFiles = async (files: File[], inline: boolean): Promise<NodeV2InlineImage[]> => {
    if (!activeTextboxID) return [];
    const images: NodeV2InlineImage[] = [];
    for (const file of files) {
      const uploaded = await uploadMangoAttachment(requestJSON as AttachmentRequestJSON, {
        companyID,
        resourceType: "node",
        resourceID: nodeID,
        informationID: activeTextboxID,
        editorSurface: "node_v2_textbox",
        file,
        sourceKind: inline ? "editor_paste" : "user_upload",
        relationshipKind: inline ? "inline_image" : "file_attachment",
      });
      const link = await client.linkAttachment(activeTextboxID, uploaded.attachment.attachment_id, inline ? "inline_image" : "file_attachment", randomID());
      setWorkspace((current) => current ? { ...current, attachment_summaries: [link, ...current.attachment_summaries], counts: { ...current.counts, attachments: current.counts.attachments + 1 } } : current);
      if (inline) images.push({ attachmentId: uploaded.attachment.attachment_id, filename: uploaded.attachment.original_filename, mimeType: uploaded.attachment.mime_type, width: uploaded.attachment.original_width ?? null, height: uploaded.attachment.original_height ?? null });
    }
    return images;
  };

  const createComment = async () => {
    if (!activeTextboxID || !commentBody.trim()) return;
    const anchor = editorRef.current?.selectionAnchor();
    setBusy(true);
    try {
      const thread = await client.createComment(activeTextboxID, {
        idempotency_key: randomID(),
        body_text: commentBody.trim(),
        selected_quote: anchor?.selectedQuote ?? "",
        anchor_before_text: anchor?.beforeText ?? "",
        anchor_after_text: anchor?.afterText ?? "",
        anchor_status: anchor?.status ?? "unanchored",
        anchor_start_base64: anchor?.startBase64 ?? "",
        anchor_end_base64: anchor?.endBase64 ?? "",
        mentions: mentionUserID ? [{ principal_type: "user", principal_id: mentionUserID }] : [],
      });
      setComments((current) => [thread, ...current]);
      setCommentBody("");
      setMentionUserID("");
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to create the comment");
    } finally {
      setBusy(false);
    }
  };

  const reply = async (thread: NodeV2CommentThread, body: string) => {
    if (!activeTextboxID) return;
    try {
      const comment = await client.reply(activeTextboxID, thread.thread_id, { idempotency_key: randomID(), body_text: body, mentions: [] });
      setComments((current) => current.map((item) => item.thread_id === thread.thread_id ? { ...item, comments: [...item.comments, comment] } : item));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to send the reply");
    }
  };

  const loadEmail = async (threadID: string) => {
    try {
	      const page = await client.emailMessages(threadID, undefined, true);
      setEmailMessages((current) => ({ ...current, [threadID]: { items: page.items, nextCursor: page.next_cursor } }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to load email bodies");
    }
  };

  const loadMoreTextboxes = async (archived: boolean) => {
    const cursor = archived ? workspace?.archived_next_cursor : workspace?.textbox_next_cursor;
    if (!workspace || !cursor) return;
    try {
      const page = await client.textboxes(archived, cursor, 30);
      setWorkspace((current) => {
        if (!current) return current;
        return archived
          ? { ...current, archived_textboxes: [...current.archived_textboxes, ...page.items], archived_next_cursor: page.next_cursor }
          : { ...current, textboxes: [...current.textboxes, ...page.items], textbox_next_cursor: page.next_cursor };
      });
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to load more text boxes");
    }
  };

  const loadMoreEmailMessages = async (threadID: string) => {
    const currentPage = emailMessages[threadID];
    if (!currentPage?.nextCursor) return;
    try {
      const page = await client.emailMessages(threadID, currentPage.nextCursor, true);
      setEmailMessages((current) => ({ ...current, [threadID]: { items: [...(current[threadID]?.items ?? []), ...page.items], nextCursor: page.next_cursor } }));
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to load more email messages");
    }
  };
  const loadMoreTimeline = async () => {
    const cursor = workspace?.timeline.next_cursor;
    if (!workspace || !cursor) return;
    try {
      const page = await client.timeline(cursor);
      setWorkspace((current) => current ? { ...current, timeline: { items: [...current.timeline.items, ...page.items], next_cursor: page.next_cursor } } : current);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "Unable to load more timeline items");
    }
  };

  if (hidden) return null;
  if (loading) return <section className="node-v2-workspace" style={{ top: topPx }} aria-busy="true"><p>Loading Node v2…</p></section>;
  if (!workspace) return <section className="node-v2-workspace" style={{ top: topPx }}><p>Node v2 could not be loaded.</p></section>;

  const activeTextbox = workspace.textboxes.find((item) => item.textbox_id === activeTextboxID);
  const activeDocument = activeTextboxID ? documents[activeTextboxID] : undefined;
  return <section className="node-v2-workspace" style={{ top: topPx }} aria-label="Node v2 workspace" data-testid="node-v2-workspace">
    <header className="node-v2-header">
      <div><span className="node-v2-eyebrow">Node v2</span><h2>{workspace.node.name}</h2><small>{workspace.placement.logic_gate_name || "Unplaced"} · {workspace.gvic_summary.length} GVIC assignments</small></div>
      <div className={`node-v2-save-state is-${saveState}`} role="status" aria-live="polite">{saveLabel(saveState)}</div>
      <button type="button" onClick={() => void createTextbox()} disabled={!canEdit || busy}>New text box</button>
    </header>

    <div className="node-v2-layout">
      <main className="node-v2-textboxes" aria-label="Node text boxes">
        {workspace.textboxes.length === 0 && <div className="node-v2-empty"><p>This Node has no text boxes.</p>{canEdit && <button type="button" onClick={() => void createTextbox()}>Create the first text box</button>}</div>}
        {workspace.textboxes.map((textbox, index) => {
          const active = textbox.textbox_id === activeTextboxID;
          return <article className={`node-v2-textbox-card${active ? " is-active" : ""}`} key={textbox.textbox_id} data-node-v2-textbox-id={textbox.textbox_id}>
            <header>
              <button type="button" className="node-v2-textbox-title" onClick={() => void activate(textbox.textbox_id)} aria-current={active ? "true" : undefined}>Text box {index + 1}</button>
              <span>{textbox.comment_count} comments · {textbox.attachment_count} files</span>
              {canEdit && <div className="node-v2-order-actions">
                <button type="button" onClick={() => void moveTextbox(index, -1)} disabled={index === 0} aria-label={`Move text box ${index + 1} up`}>↑</button>
                <button type="button" onClick={() => void moveTextbox(index, 1)} disabled={index === workspace.textboxes.length - 1} aria-label={`Move text box ${index + 1} down`}>↓</button>
                <button type="button" onClick={() => void archiveTextbox(textbox, true)}>Archive</button>
              </div>}
            </header>
            {active && currentUserID && activeDocument
              ? <NodeV2Editor
                key={textbox.textbox_id}
                ref={editorRef}
                apiBase={apiBase}
                companyID={companyID}
                nodeID={nodeID}
                userID={currentUserID}
                textbox={activeDocument}
                client={client}
                canEdit={canEdit}
                comments={comments}
                mentionUsers={companyUsers}
                onSaveState={setSaveState}
                onUploadInlineImages={(files) => uploadFiles(files, true)}
                onError={onError}
              />
              : active ? <div className="node-v2-editor-loading" role="status">Loading this text box…</div> : <VirtualStaticTextbox apiBase={apiBase} companyID={companyID} textbox={textbox} client={client} onActivate={() => void activate(textbox.textbox_id)} />}
          </article>;
        })}

        {workspace.textbox_next_cursor && <button type="button" onClick={() => void loadMoreTextboxes(false)}>Load more text boxes</button>}
        {workspace.archived_textboxes.length > 0 && <details className="node-v2-archived">
          <summary>Archived text boxes ({workspace.archived_textboxes.length})</summary>
          {workspace.archived_textboxes.map((textbox) => <div key={textbox.textbox_id} data-node-v2-textbox-id={textbox.textbox_id}><span>Archived text box · {textbox.comment_count} comments</span><button type="button" onClick={() => void archiveTextbox(textbox, false)} disabled={!canEdit}>Restore</button></div>)}
          {workspace.archived_next_cursor && <button type="button" onClick={() => void loadMoreTextboxes(true)}>Load more archived text boxes</button>}
        </details>}
      </main>

      <aside className="node-v2-sidebar">
        <nav className="node-v2-tabs" aria-label="Node v2 details">
          {(["comments", "files", "emails", "timeline"] as const).map((item) => <button key={item} type="button" onClick={() => setPanel(item)} aria-pressed={panel === item}>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </nav>

        {panel === "comments" && <section aria-label="Text box comments">
          {!activeTextbox && <p>Select a text box to see its comments.</p>}
          {activeTextbox && <>
            <label className="node-v2-field">Comment on this text box or the current selection<textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} disabled={!canEdit} /></label>
            <label className="node-v2-field">Mention<select value={mentionUserID} onChange={(event) => setMentionUserID(event.target.value)} disabled={!canEdit}><option value="">No mention</option>{companyUsers.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name || user.email}</option>)}</select></label>
            <button type="button" onClick={() => void createComment()} disabled={!canEdit || busy || !commentBody.trim()}>Add comment</button>
            <div className="node-v2-comment-list">
              {comments.map((thread) => <article key={thread.thread_id} className="node-v2-comment-thread" data-anchor-status={thread.anchor_status}>
                {thread.selected_quote && <button type="button" className="node-v2-comment-anchor" onClick={() => editorRef.current?.focusComment(thread.thread_id)} disabled={thread.anchor_format !== "yjs_relative_v1"}><q>{thread.selected_quote}</q></button>}
                {thread.anchor_status !== "anchored" && thread.anchor_status !== "uniquely_recovered" && <p className="node-v2-anchor-fallback">{thread.anchor_format === "none" || thread.anchor_format === "legacy_offsets_v1" ? "Legacy comment without a durable highlight." : thread.anchor_status === "ambiguous" ? "This quote matches more than one place." : "The selected range was deleted; showing the saved quote."}</p>}
                {thread.comments.map((comment) => <div key={comment.comment_id} className="node-v2-comment"><strong>{comment.author_display_name}</strong><p>{comment.body_text}</p>{comment.mentions.length > 0 && <small>Mentioned: {comment.mentions.map((mention) => mention.principal_display_name).join(", ")}</small>}</div>)}
                <ThreadReply disabled={!canEdit} onReply={(body) => reply(thread, body)} />
              </article>)}
              {commentCursor && <button type="button" onClick={() => {
                const requestedCursor = commentCursor;
                void client.comments(activeTextboxID, requestedCursor).then((page) => {
                  setComments((current) => [...current, ...page.threads]); setCommentCursor(page.next_cursor);
                }).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to load more comments"));
              }} data-cursor={cursorKey(commentCursor)}>Load more comments</button>}
            </div>
          </>}
        </section>}

        {panel === "files" && <section aria-label="Node attachments">
          <div className="node-v2-file-actions">
            <button type="button" disabled={!canEdit || !activeTextbox} onClick={() => fileInputRef.current?.click()}>Attach file</button>
            <button type="button" disabled={!canEdit || !activeTextbox} onClick={() => imageInputRef.current?.click()}>Insert image</button>
            <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void uploadFiles(files, false).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to upload files")); }} />
            <input ref={imageInputRef} type="file" accept="image/*" multiple hidden onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; void uploadFiles(files, true).then((images) => editorRef.current?.insertImages(images)).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to upload images")); }} />
          </div>
          <div className="node-v2-attachment-grid">{workspace.attachment_summaries.map((link: NodeV2AttachmentLink) => <article key={link.attachment_link_id}><AttachmentPreview apiBase={apiBase} companyID={companyID} attachment={link.attachment} /><strong>{link.attachment.original_filename}</strong><span>{readableBytes(link.attachment.byte_size)} · Text box {workspace.textboxes.findIndex((item) => item.textbox_id === link.textbox_id) + 1}</span></article>)}</div>
          {workspace.attachment_next_cursor && <button type="button" onClick={() => void client.attachments(workspace.attachment_next_cursor).then((page) => setWorkspace((current) => current ? { ...current, attachment_summaries: [...current.attachment_summaries, ...page.items], attachment_next_cursor: page.next_cursor } : current)).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to load more attachments"))}>Load more attachments</button>}
        </section>}

        {panel === "emails" && <section aria-label="Node email">
          {workspace.email_thread_summaries.map((thread) => <article className="node-v2-email" key={thread.email_thread_id}>
            <strong>{thread.subject || "No subject"}</strong><p>{thread.snippet}</p><small>{thread.message_count} messages · {thread.account_email}</small>
            <div>{activeTextbox && <button type="button" disabled={!canEdit || thread.linked_textbox_ids.includes(activeTextbox.textbox_id)} onClick={() => void client.linkEmail(activeTextbox.textbox_id, thread.email_thread_id, randomID()).then(reload).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to link email"))}>Link to this text box</button>}<button type="button" onClick={() => void loadEmail(thread.email_thread_id)}>Load message bodies</button></div>
            {emailMessages[thread.email_thread_id]?.items.map((message) => <div className="node-v2-email-message" data-provider-message-id={message.provider_message_id} key={message.email_message_id}><strong>{message.from.map((address) => address.name || address.email).join(", ")}</strong><div dangerouslySetInnerHTML={{ __html: sanitizeEditorDocumentHTML(message.body_html ?? "") }} /></div>)}
            {emailMessages[thread.email_thread_id]?.nextCursor && <button type="button" onClick={() => void loadMoreEmailMessages(thread.email_thread_id)}>Load more messages</button>}
          </article>)}
          {workspace.email_next_cursor && <button type="button" onClick={() => void client.emails(workspace.email_next_cursor).then((page) => setWorkspace((current) => current ? { ...current, email_thread_summaries: [...current.email_thread_summaries, ...page.items], email_next_cursor: page.next_cursor } : current)).catch((cause) => onError(cause instanceof Error ? cause.message : "Unable to load more email"))}>Load more email</button>}
        </section>}

        {panel === "timeline" && <section aria-label="Node timeline"><ol className="node-v2-timeline">{workspace.timeline.items.map((item) => <li key={item.timeline_item_id}><strong>{timelineLabel(item)}</strong><time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString()}</time></li>)}</ol>{workspace.timeline.next_cursor && <button type="button" onClick={() => void loadMoreTimeline()}>Load more timeline</button>}</section>}
      </aside>
    </div>
  </section>;
};
