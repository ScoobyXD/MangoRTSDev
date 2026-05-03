import test from "node:test";
import assert from "node:assert/strict";
import { resolveGlobalKeyboardShortcut, shouldDeferToNativeTextEditing, type KeyboardShortcutEventLike } from "../../../frontend/src/hooks/keyboardShortcutRouting.js";

function keyEvent(input: Partial<KeyboardShortcutEventLike> & { key: string }): KeyboardShortcutEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...input,
  };
}

test("Ctrl+Z inside the editor textarea is left to native text undo", () => {
  assert.equal(
    resolveGlobalKeyboardShortcut(keyEvent({
      key: "z",
      ctrlKey: true,
      target: { tagName: "TEXTAREA", isContentEditable: false },
    })),
    null,
  );
});

test("editable descendants also keep native text shortcut handling", () => {
  const target = {
    tagName: "SPAN",
    isContentEditable: false,
    closest: (selector: string) => selector.includes("contenteditable") ? { isContentEditable: true } : null,
  };

  assert.equal(shouldDeferToNativeTextEditing(target), true);
  assert.equal(resolveGlobalKeyboardShortcut(keyEvent({ key: "y", ctrlKey: true, target })), null);
});

test("dashboard undo and redo stay available when focus is not in text editing", () => {
  const target = { tagName: "DIV", isContentEditable: false, closest: () => null };

  assert.equal(resolveGlobalKeyboardShortcut(keyEvent({ key: "z", ctrlKey: true, target })), "undo");
  assert.equal(resolveGlobalKeyboardShortcut(keyEvent({ key: "z", ctrlKey: true, shiftKey: true, target })), "redo");
  assert.equal(resolveGlobalKeyboardShortcut(keyEvent({ key: "y", ctrlKey: true, target })), "redo");
  assert.equal(resolveGlobalKeyboardShortcut(keyEvent({ key: "z", metaKey: true, target })), "undo");
});

test("delete shortcuts do not steal text editing delete keys", () => {
  assert.equal(
    resolveGlobalKeyboardShortcut(keyEvent({
      key: "Backspace",
      target: { tagName: "INPUT", isContentEditable: false },
    })),
    null,
  );
  assert.equal(
    resolveGlobalKeyboardShortcut(keyEvent({
      key: "Delete",
      target: { tagName: "DIV", isContentEditable: false, closest: () => null },
    })),
    "delete",
  );
});
