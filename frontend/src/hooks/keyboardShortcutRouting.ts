export type GlobalKeyboardCommand = "delete" | "copy" | "paste" | "undo" | "redo";

export type KeyboardShortcutEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: unknown;
  activeElement?: unknown;
  selectionAnchorNode?: unknown;
};

type EditableTargetLike = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  parentElement?: EditableTargetLike | null;
};

const TEXT_EDITING_TARGET_SELECTOR = "input, textarea, select, [contenteditable='true'], [contenteditable=''], [contenteditable='plaintext-only'], [role='textbox']";
const NATIVE_COPY_TARGET_SELECTOR = "[data-mango-copyable-image='true']";

function isEditableTargetLike(target: unknown): target is EditableTargetLike {
  return typeof target === "object" && target !== null;
}

export function shouldDeferToNativeTextEditing(target: unknown): boolean {
  if (!isEditableTargetLike(target)) return false;
  const tagName = typeof target.tagName === "string" ? target.tagName.toLowerCase() : "";
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  if (target.isContentEditable) return true;

  // Editable widgets can contain nested spans/buttons. Checking the closest
  // editable parent keeps browser text undo/copy/paste in charge for the whole
  // editing surface, not just the exact element that received the event.
  if (typeof target.closest === "function" && Boolean(target.closest(`${TEXT_EDITING_TARGET_SELECTOR}, ${NATIVE_COPY_TARGET_SELECTOR}`))) return true;
  return Boolean(target.parentElement && shouldDeferToNativeTextEditing(target.parentElement));
}

export function resolveGlobalKeyboardShortcut(event: KeyboardShortcutEventLike): GlobalKeyboardCommand | null {
  if (event.defaultPrevented) return null;
  if (shouldDeferToNativeTextEditing(event.target)) return null;
  if (shouldDeferToNativeTextEditing(event.activeElement)) return null;
  if (shouldDeferToNativeTextEditing(event.selectionAnchorNode)) return null;

  const hasCommandModifier = Boolean(event.ctrlKey || event.metaKey);
  if (!hasCommandModifier) {
    if (!event.altKey && !event.shiftKey && (event.key === "Delete" || event.key === "Backspace")) return "delete";
    return null;
  }

  if (event.altKey) return null;

  const key = event.key.toLowerCase();
  if (key === "c" && !event.shiftKey) return "copy";
  if (key === "v" && !event.shiftKey) return "paste";
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}
