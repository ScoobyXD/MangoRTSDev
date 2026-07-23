export type NodeTimelineOrderableBlock = {
  id: string;
  createdTimestamp: string;
};

export type NodeTimelineOrderableEvent = {
  event_id: string;
  created_timestamp: string;
};

function timelineTimestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function groupNodeTimelineEventsByTextBlock<
  TBlock extends NodeTimelineOrderableBlock,
  TEvent extends NodeTimelineOrderableEvent,
>(blocksNewestFirst: TBlock[], events: TEvent[]): TEvent[][] {
  const slots = Array.from({ length: blocksNewestFirst.length + 1 }, () => [] as TEvent[]);
  const sortedEvents = [...events].sort((left, right) => (
    timelineTimestamp(right.created_timestamp) - timelineTimestamp(left.created_timestamp)
    || right.created_timestamp.localeCompare(left.created_timestamp)
    || right.event_id.localeCompare(left.event_id)
  ));

  for (const event of sortedEvents) {
    const eventTimestamp = timelineTimestamp(event.created_timestamp);
    const blockIndex = blocksNewestFirst.findIndex(
      (block) => eventTimestamp >= timelineTimestamp(block.createdTimestamp),
    );
    slots[blockIndex >= 0 ? blockIndex : blocksNewestFirst.length].push(event);
  }

  return slots;
}
