import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { getText, getTextSerializersFromSchema } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { BoundRequestJSON } from "../api/requestJSON.js";
import { openEditorEntityLink, readEditorEntityLinkElement } from "../editor/editorEntityLinks.js";
import { UniversalEntityPicker, type UniversalEntityPickerAnchor } from "../editor/UniversalEntityPicker.js";
import { createMangoTiptapExtensions } from "../editor/tiptap/mangoTiptapExtensions.js";

export type AssistantProcess = { id: string; label: string };
export type AssistantDraft = { text: string; process: AssistantProcess | null };
export type AssistantComposerHandle = {
  clear: () => void; clearMessage: () => void; bindProcess: (process: AssistantProcess) => void;
  beginDictation: () => boolean; finishDictation: (text?: string) => void;
};
type Props = {
  companyID: string;
  requestJSON: BoundRequestJSON;
  disabled: boolean;
  visible: boolean;
  placeholder: string;
  onChange: (draft: AssistantDraft) => void;
  onSubmit: () => void;
  onPickerChange: (open: boolean) => void;
};
type PickerDraft = { from: number; to: number; anchor: UniversalEntityPickerAnchor };
const PROCESS_TYPES = ["logic_gate"] as const;
const NO_LINK_TYPES = [] as const;

function readDraft(editor: Editor): AssistantDraft {
  const { doc } = editor.state;
  let process: AssistantProcess | null = null;
  doc.descendants((node) => {
    if (node.type.name === "mangoEntityLink" && node.attrs.entityType === "logic_gate") {
      process = { id: String(node.attrs.entityId), label: String(node.attrs.label) };
    }
  });
  return {
    text: getText(doc, { blockSeparator: "\n", textSerializers: {
      ...getTextSerializersFromSchema(editor.schema), mangoEntityLink: ({ node }) => `#${String(node.attrs.label)}`,
    } }),
    process,
  };
}

export const AssistantComposer = React.forwardRef<AssistantComposerHandle, Props>(function AssistantComposer(props, ref) {
  const latest = useRef(props);
  latest.current = props;
  const [picker, setPicker] = useState<PickerDraft | null>(null);
  const pickerRef = useRef<PickerDraft | null>(null);
  const dictation = useRef<{ doc: Editor["state"]["doc"]; position: number } | null>(null);
  const updatePicker = (draft: PickerDraft | null) => {
    pickerRef.current = draft;
    setPicker(draft);
    latest.current.onPickerChange(Boolean(draft));
  };
  const extensions = useMemo(() => createMangoTiptapExtensions({ editable: true })
    .filter((extension) => extension.name === "starterKit" || extension.name === "mangoEntityLink"), []);
  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    content: "",
    editable: !props.disabled,
    onUpdate: ({ editor: current }) => latest.current.onChange(readDraft(current)),
    editorProps: {
      attributes: { role: "textbox", "aria-label": "Message Mango", "aria-multiline": "true", class: "mango-assistant-input" },
      handlePaste: (view, event) => {
        if (latest.current.disabled || dictation.current) { event.preventDefault(); return true; }
        const text = event.clipboardData?.getData("text/plain");
        if (text === undefined) return false;
        event.preventDefault();
        view.dispatch(view.state.tr.insertText(text));
        return true;
      },
      handleClick: (_view, _position, event) => {
        const entity = readEditorEntityLinkElement((event.target as Element | null)?.closest('[data-mango-entity-link="true"]') ?? null);
        if (!entity) return false;
        event.preventDefault();
        openEditorEntityLink(entity);
        return true;
      },
      handleKeyDown: (view, event) => {
        if (latest.current.disabled || dictation.current) { event.preventDefault(); return true; }
        if (event.isComposing || view.composing) return false;
        const entity = readEditorEntityLinkElement((event.target as Element | null)?.closest('[data-mango-entity-link="true"]') ?? null);
        if (entity && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          openEditorEntityLink(entity);
          return true;
        }
        if (event.key === "#" && !event.ctrlKey && !event.metaKey && !event.altKey && !pickerRef.current) {
          const { from, to } = view.state.selection;
          event.preventDefault();
          view.dispatch(view.state.tr.insertText("#", from, to));
          const rect = view.dom.getBoundingClientRect();
          updatePicker({ from, to: from + 1, anchor: { left: rect.left, top: rect.top } });
          return true;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (!pickerRef.current) latest.current.onSubmit();
          return true;
        }
        return false;
      },
    },
  });
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!props.disabled && !dictation.current);
    editor.view.dom.setAttribute("aria-disabled", String(props.disabled));
    editor.view.dom.setAttribute("data-placeholder", props.placeholder);
  }, [editor, props.disabled, props.placeholder]);
  useEffect(() => { if (!props.visible) updatePicker(null); }, [props.visible]);
  const clearMessage = (process: AssistantProcess | null) => editor?.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: process ? [
    { type: "mangoEntityLink", attrs: { entityType: "logic_gate", entityId: process.id, label: process.label } },
    { type: "text", text: " " },
  ] : [] }] });
  useImperativeHandle(ref, () => ({
    clear: () => { updatePicker(null); editor?.commands.clearContent(); },
    clearMessage: () => {
      if (!editor) return;
      clearMessage(readDraft(editor).process);
    },
    bindProcess: clearMessage,
    beginDictation: () => {
      if (!editor || latest.current.disabled || pickerRef.current || dictation.current) return false;
      // Insert after a selection, so dictation never replaces text or a Process reference.
      dictation.current = { doc: editor.state.doc, position: editor.state.selection.to };
      editor.setEditable(false);
      return true;
    },
    finishDictation: (text) => {
      const saved = dictation.current;
      dictation.current = null;
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(!latest.current.disabled);
      if (!saved || text === undefined) return;
      if (!editor.state.doc.eq(saved.doc)) throw new Error("The draft changed. Please record again.");
      const transaction = closeHistory(editor.state.tr.insertText(text, saved.position, saved.position));
      editor.view.dispatch(transaction);
    },
  }), [editor]);

  return <>
    <EditorContent editor={editor} className="mango-assistant-editor" />
    {picker && editor && <UniversalEntityPicker
      companyID={props.companyID}
      requestJSON={props.requestJSON}
      sourceLabel="Select a Process for Mango"
      linkTargetTypes={NO_LINK_TYPES}
      referenceTargetTypes={PROCESS_TYPES}
      initialMode="reference"
      initialCategory="logic_gate"
      lockMode
      anchor={picker.anchor}
      onCancel={() => { const to = picker.to; updatePicker(null); editor.commands.focus(to); }}
      onChoose={async (entity) => {
        if (entity.entityType !== "logic_gate") throw new Error("Select a Process.");
        if (editor.state.doc.textBetween(picker.from, picker.to, "", "") !== "#") throw new Error("Open the picker again after editing your message.");
        const transaction = editor.state.tr;
        const previous: Array<{ from: number; to: number }> = [];
        transaction.doc.descendants((node, position) => {
          if (node.type.name === "mangoEntityLink") previous.push({ from: position, to: position + node.nodeSize });
        });
        for (const range of previous.reverse()) transaction.delete(range.from, range.to);
        const from = transaction.mapping.map(picker.from);
        const to = transaction.mapping.map(picker.to);
        transaction.replaceWith(from, to, [
          editor.schema.nodes.mangoEntityLink.create({ entityType: "logic_gate", entityId: entity.entityID, label: entity.label }),
          editor.schema.text(" "),
        ]);
        editor.view.dispatch(transaction);
        updatePicker(null);
        editor.commands.focus(from + 2);
      }}
    />}
  </>;
});
