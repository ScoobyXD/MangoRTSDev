import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  compactMangoTiptapDocument,
  type MangoTiptapDocument,
} from "./tiptap/mangoTiptapDocument.js";
import { createMangoTiptapExtensions } from "./tiptap/mangoTiptapExtensions.js";
import "./tiptap/mangoTiptap.css";

export type EntityDetailsRichEditorProps = {
  value: MangoTiptapDocument;
  disabled?: boolean;
  onChange: (value: MangoTiptapDocument) => void;
};

export function EntityDetailsRichEditor({ value, disabled = false, onChange }: EntityDetailsRichEditorProps) {
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [, renderToolbar] = useState(0);
  onChangeRef.current = onChange;
  const extensions = useMemo(() => createMangoTiptapExtensions({ editable: !disabled }), []);

  useEffect(() => {
    const nextEditor = new Editor({
      content: initialValueRef.current.document,
      editable: !disabled,
      extensions,
      editorProps: {
        attributes: {
          "aria-label": "Entity details rich text",
          class: "mango-tiptap-prosemirror",
        },
      },
      onSelectionUpdate: () => renderToolbar((current) => current + 1),
      onUpdate: ({ editor: activeEditor }) => {
        renderToolbar((current) => current + 1);
        onChangeRef.current(compactMangoTiptapDocument({
          format: initialValueRef.current.format,
          schema_version: initialValueRef.current.schema_version,
          document: activeEditor.getJSON(),
        }, activeEditor.schema));
      },
    });
    setEditor(nextEditor);
    return () => {
      nextEditor.destroy();
    };
  }, [extensions]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  const run = (command: () => boolean) => {
    if (!editor || disabled) return;
    command();
    editor.commands.focus();
    renderToolbar((current) => current + 1);
  };

  return (
    <div data-mango-entity-details-rich-editor="true" style={editorFrameStyle}>
      <div role="toolbar" aria-label="Entity details formatting" style={toolbarStyle} onMouseDown={(event) => event.preventDefault()}>
        <FormatButton label="Bold" active={Boolean(editor?.isActive("bold"))} disabled={!editor || disabled} onClick={() => run(() => editor!.chain().focus().toggleBold().run())}>B</FormatButton>
        <FormatButton label="Italic" active={Boolean(editor?.isActive("italic"))} disabled={!editor || disabled} onClick={() => run(() => editor!.chain().focus().toggleItalic().run())}><em>I</em></FormatButton>
        <FormatButton label="Underline" active={Boolean(editor?.isActive("underline"))} disabled={!editor || disabled} onClick={() => run(() => editor!.chain().focus().toggleUnderline().run())}><u>U</u></FormatButton>
        <FormatButton label="Bullet list" active={Boolean(editor?.isActive("bulletList"))} disabled={!editor || disabled} onClick={() => run(() => editor!.chain().focus().toggleBulletList().run())}>• List</FormatButton>
        <FormatButton label="Numbered list" active={Boolean(editor?.isActive("orderedList"))} disabled={!editor || disabled} onClick={() => run(() => editor!.chain().focus().toggleOrderedList().run())}>1. List</FormatButton>
      </div>
      <div style={contentStyle}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function FormatButton({ label, active, disabled, onClick, children }: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      style={formatButtonStyle(active, disabled)}
    >
      {children}
    </button>
  );
}

const editorFrameStyle: React.CSSProperties = { overflow: "hidden", border: "1px solid rgba(148,163,184,.3)", borderRadius: 10, background: "#fff" };
const toolbarStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4, padding: 6, borderBottom: "1px solid rgba(148,163,184,.22)", background: "#f8fafc" };
const contentStyle: React.CSSProperties = { minHeight: 132, maxHeight: 280, overflowY: "auto" };
const formatButtonStyle = (active: boolean, disabled: boolean): React.CSSProperties => ({ minWidth: 30, minHeight: 28, border: `1px solid ${active ? "rgba(13,148,136,.45)" : "rgba(148,163,184,.26)"}`, borderRadius: 7, background: active ? "#ccfbf1" : "#fff", color: active ? "#115e59" : "#334155", padding: "3px 7px", font: "inherit", fontSize: 11, fontWeight: 800, cursor: disabled ? "default" : "pointer", opacity: disabled ? .55 : 1 });
