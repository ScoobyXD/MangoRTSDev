import React, { useMemo } from "react";

interface GridBackgroundProps {
  cols: number;
  rowHeight: number;
  margin: [number, number];
  containerWidth: number;
  gridHeight: number;
}

const GridBackground: React.FC<GridBackgroundProps> = ({
  cols,
  rowHeight,
  margin,
  containerWidth,
  gridHeight,
}) => {
  const dots = useMemo(() => {
    const colWidth = (containerWidth - margin[0] * (cols + 1)) / cols;
    const cellStepX = colWidth + margin[0];
    const cellStepY = rowHeight + margin[1];
    const rows = Math.ceil(gridHeight / cellStepY) + 2;
    const points: { x: number; y: number }[] = [];

    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        points.push({
          x: margin[0] + c * cellStepX,
          y: margin[1] + r * cellStepY,
        });
      }
    }
    return points;
  }, [cols, rowHeight, margin, containerWidth, gridHeight]);

  return (
    <svg
      width={containerWidth}
      height={gridHeight + (rowHeight + margin[1]) * 2}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {dots.map((dot, i) => (
        <circle key={i} cx={dot.x} cy={dot.y} r="2" fill="#bbb" opacity="0.35" />
      ))}
    </svg>
  );
};

export default GridBackground;
