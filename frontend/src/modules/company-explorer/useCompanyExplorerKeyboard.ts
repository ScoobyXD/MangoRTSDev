import type React from "react";
import { useCallback, useEffect } from "react";
import { resolveExplorerKeyboardNavigation } from "./treePresentation";
import { isExplorerTextInputTarget } from "./companyExplorerDragDrop";
import type { ExplorerTreeNode } from "./companyExplorerTypes";

type UseCompanyExplorerKeyboardInput = {
  treeViewportRef: React.RefObject<HTMLDivElement>;
  treeKeyboardActiveRef: React.MutableRefObject<boolean>;
  selectedTreeIDRef: React.MutableRefObject<string>;
  expandedRef: React.MutableRefObject<Set<string>>;
  treeRowsRef: React.MutableRefObject<ExplorerTreeNode[]>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectSingleTreeRow: (row: ExplorerTreeNode) => void;
  scrollTreeRowIntoView: (rowID: string) => void;
};

export function useCompanyExplorerKeyboard({
  treeViewportRef,
  treeKeyboardActiveRef,
  selectedTreeIDRef,
  expandedRef,
  treeRowsRef,
  setExpanded,
  selectSingleTreeRow,
  scrollTreeRowIntoView,
}: UseCompanyExplorerKeyboardInput) {
  const handleTreeKeyCommand = useCallback((event: React.KeyboardEvent<HTMLDivElement> | KeyboardEvent) => {
    if (isExplorerTextInputTarget(event.target) && event.target instanceof Node && treeViewportRef.current?.contains(event.target)) return;
    const activeTreeRows = treeRowsRef.current;
    const result = resolveExplorerKeyboardNavigation({
      rows: activeTreeRows.map((row) => ({ id: row.id, kind: row.kind })),
      selectedTreeID: selectedTreeIDRef.current,
      expandedIDs: expandedRef.current,
      key: event.key,
    });
    if (!result.handled) return;

    event.preventDefault();
    if (result.expandedIDs) {
      expandedRef.current = result.expandedIDs;
      setExpanded(result.expandedIDs);
    }
    if (result.selectedTreeID) {
      const next = activeTreeRows.find((row) => row.id === result.selectedTreeID);
      if (!next) return;
      selectSingleTreeRow(next);
      scrollTreeRowIntoView(next.id);
    }
  }, [expandedRef, scrollTreeRowIntoView, selectSingleTreeRow, selectedTreeIDRef, setExpanded, treeRowsRef, treeViewportRef]);

  const handleTreeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    handleTreeKeyCommand(event);
  }, [handleTreeKeyCommand]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!treeKeyboardActiveRef.current || event.defaultPrevented) return;
      handleTreeKeyCommand(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleTreeKeyCommand, treeKeyboardActiveRef]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && treeViewportRef.current?.contains(target)) return;
      treeKeyboardActiveRef.current = false;
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [treeKeyboardActiveRef, treeViewportRef]);

  return handleTreeKeyDown;
}
