import React, { forwardRef, useImperativeHandle } from "react";

export type ProcessMapDeckGLTestProps = {
  layers: Array<{ id: string; props: Record<string, unknown> }>;
  viewState: Record<string, unknown>;
  onClick: (info: { object?: unknown; coordinate?: number[] }, event: { type: string }) => void;
  onHover: (info: { object?: unknown; coordinate?: number[] }) => void;
  onDragStart: (info: { object?: unknown; coordinate?: number[] }, event: {
    stopPropagation: () => void;
    shiftKey?: boolean;
    srcEvent?: { shiftKey?: boolean };
  }) => void;
  onDrag: (info: { object?: unknown; coordinate?: number[] }) => void;
  onDragEnd: (info: { object?: unknown; coordinate?: number[] }) => void;
  onResize: (size: { width: number; height: number }) => void;
};

let latestProps: ProcessMapDeckGLTestProps | null = null;
let pickedObject: unknown = null;

export function setProcessMapDeckGLPickedObjectForTest(object: unknown): void {
  pickedObject = object;
}

export function readProcessMapDeckGLTestProps(): ProcessMapDeckGLTestProps {
  if (!latestProps) throw new Error("process_map_deck_not_rendered");
  return latestProps;
}

export function resetProcessMapDeckGLTestStub(): void {
  latestProps = null;
  pickedObject = null;
}

const ProcessMapDeckGLTestStub = forwardRef<unknown, ProcessMapDeckGLTestProps>((props, ref) => {
  useImperativeHandle(ref, () => ({ pickObject: () => ({ object: pickedObject }) }));
  latestProps = props;
  return <div data-process-map-deck-test-stub="true" />;
});

export default ProcessMapDeckGLTestStub;
