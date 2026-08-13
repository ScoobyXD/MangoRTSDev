export type MangoTiptapImagePosition = "break" | "wrap";
export type MangoTiptapImageAlignment = "left" | "center" | "right";

export type MangoTiptapImagePlacement = {
  position: MangoTiptapImagePosition;
  alignment: MangoTiptapImageAlignment;
};

export function normalizeMangoTiptapImagePlacement(attributes: {
  position?: unknown;
  alignment?: unknown;
}): MangoTiptapImagePlacement {
  const alignment = ["left", "center", "right"].includes(String(attributes.alignment))
    ? attributes.alignment as MangoTiptapImageAlignment
    : "left";
  return {
    position: attributes.position === "wrap" && alignment !== "center" ? "wrap" : "break",
    alignment,
  };
}

export function mangoTiptapImagePlacementAtX(
  clientX: number,
  editorBounds: Pick<DOMRect, "left" | "width">,
): MangoTiptapImagePlacement {
  if (editorBounds.width <= 0) return { position: "break", alignment: "center" };
  const horizontalRatio = (clientX - editorBounds.left) / editorBounds.width;
  if (horizontalRatio < 0.3) return { position: "wrap", alignment: "left" };
  if (horizontalRatio > 0.7) return { position: "wrap", alignment: "right" };
  return { position: "break", alignment: "center" };
}

export function mangoTiptapImagePlacementDOMAttributes(attributes: {
  position?: unknown;
  alignment?: unknown;
}): Record<string, string> {
  const placement = normalizeMangoTiptapImagePlacement(attributes);
  return {
    "data-mango-image-position": placement.position,
    "data-mango-image-alignment": placement.alignment,
  };
}
