import test from "node:test";
import assert from "node:assert/strict";
import { resolveGlobalKeyboardShortcut, shouldDeferToNativeTextEditing, shouldNavigateBrowserHistoryBack, type KeyboardShortcutEventLike } from "../../../frontend/src/hooks/keyboardShortcutRouting.js";

function keyEvent(input: Partial<KeyboardShortcutEventLike> & { key: string }): KeyboardShortcutEventLike {
  return {
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...input,
  };
}

test("Ctrl+Z inside the editor textarea is not routed to dashboard undo", () => {
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

test("copyable image controls keep Ctrl+C out of dashboard frame copy", () => {
  const target = {
    tagName: "BUTTON",
    isContentEditable: false,
    closest: (selector: string) => selector.includes("data-mango-copyable-image") ? { isContentEditable: false } : null,
  };

  assert.equal(shouldDeferToNativeTextEditing(target), true);
  assert.equal(resolveGlobalKeyboardShortcut(keyEvent({ key: "c", ctrlKey: true, target })), null);
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

test("Logic Gate history can use unmodified Backspace outside editable content", () => {
  const surface = { tagName: "DIV", isContentEditable: false, closest: () => null };
  assert.equal(shouldNavigateBrowserHistoryBack(keyEvent({ key: "Backspace", target: surface })), true);
  assert.equal(shouldNavigateBrowserHistoryBack(keyEvent({ key: "Backspace", target: { tagName: "TEXTAREA" } })), false);
  assert.equal(shouldNavigateBrowserHistoryBack(keyEvent({ key: "Backspace", altKey: true, target: surface })), false);
  assert.equal(shouldNavigateBrowserHistoryBack(keyEvent({ key: "Backspace", repeat: true, target: surface })), false);
  assert.equal(shouldNavigateBrowserHistoryBack(keyEvent({ key: "Delete", target: surface })), false);
});
