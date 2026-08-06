const INFORMATION_TARGET_ATTRIBUTES = [
  "data-node-timeline-event-id",
  "data-node-text-block-id",
  "data-node-chat-block-id",
  "data-node-chat-message-id",
  "data-project-text-box-row",
  "data-project-text-block-id",
  "data-email-message-id",
  "data-logic-gate-information-id",
] as const;

const MENTION_TARGET_ATTRIBUTES = [
  "data-mango-user-id",
  "data-mango-mention-user-id",
] as const;

const EDITOR_TEXTBOX_TARGET_ATTRIBUTES = [
  "data-node-text-block-id",
  "data-project-text-box-row",
  "data-project-text-block-id",
  "data-logic-gate-information-id",
] as const;

function findElementByAttributeValue(
  root: ParentNode,
  attributes: readonly string[],
  value: string,
): HTMLElement | null {
  const selector = attributes.map((attribute) => `[${attribute}]`).join(", ");
  return Array.from(root.querySelectorAll<HTMLElement>(selector))
    .find((element) => attributes.some((attribute) => element.getAttribute(attribute) === value)) ?? null;
}

export function resolveTransientInformationFocusTarget(input: {
  root: ParentNode | null;
  informationID: string;
  mentionUserID?: string;
}): HTMLElement | null {
  const informationID = input.informationID.trim();
  if (!input.root || !informationID) return null;
  const informationTarget = findElementByAttributeValue(input.root, INFORMATION_TARGET_ATTRIBUTES, informationID);
  if (!informationTarget) return null;

  const mentionUserID = input.mentionUserID?.trim() ?? "";
  if (!mentionUserID) return informationTarget;
  return findElementByAttributeValue(informationTarget, MENTION_TARGET_ATTRIBUTES, mentionUserID)
    ?? informationTarget;
}

function animateTransientInformationTarget(target: HTMLElement, scroll = true): HTMLElement {
  if (scroll) target.scrollIntoView?.({ block: "center", inline: "nearest", behavior: "smooth" });
  target.animate?.([
    { backgroundColor: "rgba(250, 204, 21, 0)", boxShadow: "0 0 0 0 rgba(234, 88, 12, 0)" },
    { backgroundColor: "rgba(254, 240, 138, 0.96)", boxShadow: "0 0 0 4px rgba(234, 88, 12, 0.30)" },
    { backgroundColor: "rgba(250, 204, 21, 0)", boxShadow: "0 0 0 0 rgba(234, 88, 12, 0)" },
  ], { duration: 1800, easing: "ease-out" });
  return target;
}

function focusTransientInformationTarget(informationTarget: HTMLElement, target: HTMLElement): HTMLElement {
  animateTransientInformationTarget(target);
  if (
    target !== informationTarget
    && EDITOR_TEXTBOX_TARGET_ATTRIBUTES.some((attribute) => informationTarget.hasAttribute(attribute))
  ) {
    animateTransientInformationTarget(informationTarget, false);
  }
  return target;
}

export function transientlyFocusInformation(input: {
  root: ParentNode | null;
  informationID: string;
  mentionUserID?: string;
}): HTMLElement | null {
  const informationID = input.informationID.trim();
  if (!input.root || !informationID) return null;
  const informationTarget = findElementByAttributeValue(input.root, INFORMATION_TARGET_ATTRIBUTES, informationID);
  if (!informationTarget) return null;
  const mentionUserID = input.mentionUserID?.trim() ?? "";
  const target = mentionUserID
    ? findElementByAttributeValue(informationTarget, MENTION_TARGET_ATTRIBUTES, mentionUserID) ?? informationTarget
    : informationTarget;
  return focusTransientInformationTarget(informationTarget, target);
}

export function scheduleTransientInformationFocus(input: {
  root: () => ParentNode | null;
  informationID: string;
  mentionUserID?: string;
}): () => void {
  const informationID = input.informationID.trim();
  const mentionUserID = input.mentionUserID?.trim() ?? "";
  if (!informationID || typeof window === "undefined") return () => undefined;
  let stopped = false;
  let frame = 0;
  const timers: number[] = [];
  const delays = [80, 240, 600];

  const attempt = (allowSectionFallback: boolean) => {
    if (stopped) return true;
    const root = input.root();
    if (!root) return false;
    const informationTarget = findElementByAttributeValue(root, INFORMATION_TARGET_ATTRIBUTES, informationID);
    if (!informationTarget) return false;
    const mentionTarget = mentionUserID
      ? findElementByAttributeValue(informationTarget, MENTION_TARGET_ATTRIBUTES, mentionUserID)
      : null;
    if (mentionTarget) {
      focusTransientInformationTarget(informationTarget, mentionTarget);
      stopped = true;
      return true;
    }
    if (!mentionUserID || allowSectionFallback) {
      animateTransientInformationTarget(informationTarget);
      stopped = true;
      return true;
    }
    return false;
  };

  frame = window.requestAnimationFrame(() => attempt(false));
  delays.forEach((delay, index) => {
    timers.push(window.setTimeout(() => attempt(index === delays.length - 1), delay));
  });
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
    timers.forEach((timer) => window.clearTimeout(timer));
  };
}
