import type { Editor } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export type MangoTiptapAnnotationKind = "comment" | "change" | "chat" | "email-selection";

export type MangoTiptapAnnotation = {
  id: string;
  kind: MangoTiptapAnnotationKind;
  from: number;
  to: number;
  active?: boolean;
};

type AnnotationPluginState = {
  annotations: MangoTiptapAnnotation[];
  decorations: DecorationSet;
};

const annotationPluginKey = new PluginKey<AnnotationPluginState>("mangoTiptapAnnotations");
const annotationMetaKey = "mangoTiptapAnnotations:set";

function normalizedAnnotations(annotations: readonly MangoTiptapAnnotation[], documentSize: number): MangoTiptapAnnotation[] {
  return annotations.flatMap((annotation) => {
    const from = Math.max(1, Math.min(documentSize, Math.trunc(annotation.from)));
    const to = Math.max(from, Math.min(documentSize, Math.trunc(annotation.to)));
    return to > from && annotation.id.trim()
      ? [{ ...annotation, id: annotation.id.trim(), from, to }]
      : [];
  });
}

function createDecorations(document: Parameters<typeof DecorationSet.create>[0], annotations: readonly MangoTiptapAnnotation[]): DecorationSet {
  return DecorationSet.create(document, annotations.map((annotation) => Decoration.inline(
    annotation.from,
    annotation.to,
    {
      class: `mango-tiptap-annotation mango-tiptap-annotation--${annotation.kind}${annotation.active ? " is-active" : ""}`,
      "data-mango-annotation-id": annotation.id,
      "data-mango-annotation-kind": annotation.kind,
    },
    { mangoAnnotationId: annotation.id },
  )));
}

export const MangoTiptapAnnotations = new Plugin<AnnotationPluginState>({
  key: annotationPluginKey,
  state: {
    init: () => ({ annotations: [], decorations: DecorationSet.empty }),
    apply(transaction, previous, _oldState, newState) {
      const replacement = transaction.getMeta(annotationMetaKey) as MangoTiptapAnnotation[] | undefined;
      if (replacement) {
        const annotations = normalizedAnnotations(replacement, newState.doc.content.size);
        return { annotations, decorations: createDecorations(newState.doc, annotations) };
      }
      if (!transaction.docChanged) return previous;
      const mapped = previous.annotations.flatMap((annotation) => {
        const from = transaction.mapping.mapResult(annotation.from, 1);
        const to = transaction.mapping.mapResult(annotation.to, -1);
        return from.deletedAcross || to.deletedAcross || to.pos <= from.pos
          ? []
          : [{ ...annotation, from: from.pos, to: to.pos }];
      });
      return { annotations: mapped, decorations: createDecorations(newState.doc, mapped) };
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

export function updateMangoTiptapAnnotations(editor: Editor, annotations: readonly MangoTiptapAnnotation[]): void {
  editor.view.dispatch(setMangoTiptapAnnotations(editor.state.tr, annotations));
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
    position = readMappedMangoTiptapAnnotations(editor).find((annotation) => annotation.id === target.annotationID)?.from;
  }
  if (position === undefined || position === null) return false;
  const safePosition = Math.max(1, Math.min(editor.state.doc.content.size, Math.trunc(position)));
  editor.commands.setTextSelection(safePosition);
  editor.commands.scrollIntoView();
  editor.commands.focus();
  return true;
}
