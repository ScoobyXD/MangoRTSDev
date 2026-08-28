import React, { forwardRef } from "react";

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

export function readProcessMapDeckGLTestProps(): ProcessMapDeckGLTestProps {
  if (!latestProps) throw new Error("process_map_deck_not_rendered");
  return latestProps;
}

export function resetProcessMapDeckGLTestStub(): void {
  latestProps = null;
}

const ProcessMapDeckGLTestStub = forwardRef<unknown, ProcessMapDeckGLTestProps>((props, _ref) => {
  latestProps = props;
  return <div data-process-map-deck-test-stub="true" />;
});

export default ProcessMapDeckGLTestStub;
