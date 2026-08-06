import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getCurrentEditorTraceContext, traceEditorFunction } from "../editorTrace.js";

export type MangoTiptapAnnotationKind = "comment" | "change" | "chat" | "email-selection";

export type MangoTiptapAnnotation = {
  id: string;
  kind: MangoTiptapAnnotationKind;
  from: number;
  to: number;
  active?: boolean;
  durable?: false;
};

export type MangoTiptapPersistedAnnotation = Pick<MangoTiptapAnnotation, "id" | "kind" | "from" | "to">;

export function isDormantMangoTiptapAnnotation(
  annotation: Pick<MangoTiptapAnnotation, "kind">,
): boolean {
  return annotation.kind === "change";
}

export function durableMangoTiptapAnnotations(
  annotations: readonly MangoTiptapAnnotation[],
): MangoTiptapPersistedAnnotation[] {
  return annotations.flatMap((annotation) => annotation.durable === false
    ? []
    : [{ id: annotation.id, kind: annotation.kind, from: annotation.from, to: annotation.to }]);
}

export function mergeMangoTiptapAnnotationPositions(
  annotations: readonly MangoTiptapAnnotation[],
  persisted: readonly MangoTiptapPersistedAnnotation[] | undefined,
): MangoTiptapAnnotation[] {
  if (!persisted?.length) return [...annotations];
  const positions = new Map(persisted.map((annotation) => [`${annotation.kind}:${annotation.id}`, annotation]));
  const ownedKeys = new Set(annotations.map((annotation) => `${annotation.kind}:${annotation.id}`));
  const merged = annotations.map((annotation) => {
    const position = positions.get(`${annotation.kind}:${annotation.id}`);
    return position ? { ...annotation, from: position.from, to: position.to } : annotation;
  });
  persisted.forEach((annotation) => {
    const key = `${annotation.kind}:${annotation.id}`;
    if (isDormantMangoTiptapAnnotation(annotation) && !ownedKeys.has(key)) merged.push({ ...annotation });
  });
  return merged;
}

export function mangoTiptapAnnotationsEqual(
  left: readonly MangoTiptapAnnotation[],
  right: readonly MangoTiptapAnnotation[],
): boolean {
  return left.length === right.length && left.every((annotation, index) => {
    const other = right[index];
    return Boolean(other) && annotation.id === other.id && annotation.kind === other.kind
      && annotation.from === other.from && annotation.to === other.to
      && annotation.active === other.active && annotation.durable === other.durable;
  });
}

type AnnotationPluginState = {
  annotations: MangoTiptapAnnotation[];
  decorations: DecorationSet;
};

const annotationPluginKey = new PluginKey<AnnotationPluginState>("mangoTiptapAnnotations");
const annotationMetaKey = "mangoTiptapAnnotations:set";

function normalizedAnnotations(annotations: readonly MangoTiptapAnnotation[], documentSize: number): MangoTiptapAnnotation[] {
  return annotations.flatMap((annotation) => {
    const from = Math.max(0, Math.min(documentSize, Math.trunc(annotation.from)));
    const to = Math.max(from, Math.min(documentSize, Math.trunc(annotation.to)));
    return to > from && annotation.id.trim()
      ? [{ ...annotation, id: annotation.id.trim(), from, to }]
      : [];
  });
}

function createDecorations(document: Parameters<typeof DecorationSet.create>[0], annotations: readonly MangoTiptapAnnotation[]): DecorationSet {
  if (annotations.length === 0) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  annotations.forEach((annotation) => {
    if (isDormantMangoTiptapAnnotation(annotation)) return;
    const attributes = {
      class: `mango-tiptap-annotation mango-tiptap-annotation--${annotation.kind}${annotation.active ? " is-active" : ""}`,
      "data-mango-annotation-id": annotation.id,
      "data-mango-annotation-kind": annotation.kind,
    };
    const spec = { mangoAnnotationId: annotation.id, mangoAnnotationKind: annotation.kind };
    decorations.push(Decoration.inline(annotation.from, annotation.to, attributes, spec));
    document.nodesBetween(annotation.from, annotation.to, (node, position) => {
      if (node.isAtom && annotation.from <= position && annotation.to >= position + node.nodeSize) {
        decorations.push(Decoration.node(position, position + node.nodeSize, attributes, spec));
      }
    });
  });
  return DecorationSet.create(document, decorations);
}

export const MangoTiptapAnnotations = new Plugin<AnnotationPluginState>({
  key: annotationPluginKey,
  state: {
    init: () => ({ annotations: [], decorations: DecorationSet.empty }),
    apply(transaction, previous, _oldState, newState) {
      return traceEditorFunction(
        getCurrentEditorTraceContext(),
        "plugin.annotations.apply",
        "prosemirror.plugin",
        () => {
      const replacement = transaction.getMeta(annotationMetaKey) as MangoTiptapAnnotation[] | undefined;
      if (replacement) {
        const annotations = normalizedAnnotations(replacement, newState.doc.content.size);
        return { annotations, decorations: createDecorations(newState.doc, annotations) };
      }
      if (!transaction.docChanged) return previous;
      if (previous.annotations.length === 0) return previous;
      const mapped = previous.annotations.flatMap((annotation) => {
        const from = transaction.mapping.mapResult(annotation.from, 1);
        const to = transaction.mapping.mapResult(annotation.to, -1);
        return from.deletedAcross || to.deletedAcross || to.pos <= from.pos
          ? []
          : [{ ...annotation, from: from.pos, to: to.pos }];
      });
      if (mapped.length === 0) return { annotations: [], decorations: DecorationSet.empty };
      let decorations = previous.decorations.map(transaction.mapping, newState.doc);
      if (mapped.length !== previous.annotations.length) {
        const remaining = new Set(mapped.map((annotation) => `${annotation.kind}:${annotation.id}`));
        const removed = decorations.find(
          undefined,
          undefined,
          (spec) => !remaining.has(`${String(spec.mangoAnnotationKind)}:${String(spec.mangoAnnotationId)}`),
        );
        if (removed.length > 0) decorations = decorations.remove(removed);
      }
      return { annotations: mapped, decorations };
        }, {
          doc_changed: transaction.docChanged,
          previous_annotation_count: previous.annotations.length,
          replacement: Boolean(transaction.getMeta(annotationMetaKey)),
        });
    },
  },
  props: {
    decorations(state) {
      return annotationPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
    },
    handleClick(_view, _position, event) {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-mango-annotation-id]") : null;
      if (!target) return false;
      target.dispatchEvent(new CustomEvent("mango:tiptap-annotation-activate", {
        bubbles: true,
        detail: {
          id: target.dataset.mangoAnnotationId,
          kind: target.dataset.mangoAnnotationKind,
        },
      }));
      return true;
    },
  },
});

export function setMangoTiptapAnnotations(transaction: Transaction, annotations: readonly MangoTiptapAnnotation[]): Transaction {
  return transaction.setMeta(annotationMetaKey, [...annotations]);
}

export function updateMangoTiptapAnnotations(editor: Editor, annotations: readonly MangoTiptapAnnotation[]): boolean {
  if (mangoTiptapAnnotationsEqual(readMappedMangoTiptapAnnotations(editor), annotations)) return false;
  editor.view.dispatch(setMangoTiptapAnnotations(editor.state.tr, annotations));
  return true;
}

export function readMappedMangoTiptapAnnotations(editor: Editor): readonly MangoTiptapAnnotation[] {
  return annotationPluginKey.getState(editor.state)?.annotations ?? [];
}

export function findMangoTiptapBlockPosition(editor: Editor, blockID: string): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (found === null && node.attrs.blockId === blockID) found = position;
  });
  return found;
}

export function navigateMangoTiptapTarget(
  editor: Editor,
  target: { blockID?: string; annotationID?: string; position?: number },
): boolean {
  let position = target.position;
  if (target.blockID) position = findMangoTiptapBlockPosition(editor, target.blockID) ?? undefined;
  if (target.annotationID) {
    position = readMappedMangoTiptapAnnotations(editor).find((annotation) => (
      !isDormantMangoTiptapAnnotation(annotation) && annotation.id === target.annotationID
    ))?.from;
  }
  if (position === undefined || position === null) return false;
  const safePosition = Math.max(1, Math.min(editor.state.doc.content.size, Math.trunc(position)));
  editor.commands.setTextSelection(safePosition);
  editor.commands.scrollIntoView();
  editor.commands.focus();
  return true;
}
