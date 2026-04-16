# Live Circuit-Board UI: 1000s of Nodes at 60fps

_Architecture and rendering guide for a real-time status map with thousands of live-updating nodes. Built for an AWS-backed enterprise product._

---

## Executive Summary (The Short Version)

**This is really four problems, not one.** Transport (how updates reach the browser), state (how you store them without melting React), rendering (how you paint 1000 things at 60fps), and UX (how a human makes sense of it). Solve them separately.

**Transport:** WebSockets over JSON deltas, batched server-side into ~16ms frames. AWS AppSync Events is the managed option — purpose-built for broadcasting real-time events to many subscribers over serverless WebSockets. Roll your own on Fargate + Redis pub/sub if you want portability.

**State:** Do NOT re-render React on every message. Mutable store (Zustand, Valtio, or a plain ref), updates coalesced into one `requestAnimationFrame` paint. Parse in a Web Worker if throughput gets heavy.

**Rendering:** **WebGL, not SVG, not DOM.** PixiJS is the default pick — WebGL is roughly 10× faster than Canvas and DOM/SVG breaks around 500–1000 nodes. Viewport culling (only draw what's visible), level-of-detail (simpler shapes when zoomed out), pre-rendered background for static circuit traces. Stress-test with 10× your target count.

**UX — the actually hard part:** Don't show everything. Cluster when zoomed out, aggregate ("4 services degraded in us-east-1"), use color for status and subtle pulsing for recent changes. Mini-map, search-to-jump, time scrubber for debugging. Defaults should surface problems, not everything. Pre-attentive cues (color, motion) sparingly — if 1000 things pulse, nothing does.

**De-risk in this order:** Week 1 prototype the renderer with 5000 fake nodes. Week 2 prove the transport under load. Week 3 nail the delta protocol. Week 4 build the UX chrome.

---

## The Problem, Framed Correctly

"Thousands of live-updating nodes on a UI" is actually **four stacked problems**. Each has to be solved independently or the whole thing collapses:

1. **Transport** — How do updates get from your backend to every connected client?
2. **State** — How does the client store state and diff it efficiently?
3. **Rendering** — How do you actually paint thousands of nodes at 60fps?
4. **UX** — How do humans *comprehend* a board with 1000+ things happening?

Most teams botch this by treating it as a single "make the viz work" problem. Solve them as four separate problems and it's very tractable.

---

## Layer 1: Transport (Backend → Client)

### The options

| Option | Best for | Downsides |
|---|---|---|
| **WebSockets** | Bidirectional, low-latency, high-frequency | You manage connection state, fan-out, reconnection |
| **Server-Sent Events (SSE)** | Server → client only, simpler | One-way only, text-only, HTTP/2 connection limits |
| **AWS AppSync Events** | Managed WebSockets with fan-out built in | AWS lock-in, GraphQL-ish model |
| **AWS IoT Core (MQTT)** | Truly IoT device topology | Overkill for UI; MQTT has quirks |
| **Long polling** | Legacy fallback only | High overhead, don't use for this |

### Recommendation for your use case

**AWS AppSync Events** is the sweet spot for an AWS-native startup doing this. AWS launched it specifically for "broadcast real-time event data to a few or millions of subscribers using serverless WebSocket APIs" — you don't have to build connection management, fan-out, or scaling logic yourself.

If you want more control (or may move off AWS later), roll your own WebSockets on Fargate/EC2 with a **Redis pub/sub** layer behind it. This is the architecture Discord, Slack, and Figma use.

### The rule of roundtrips

WebSockets have the lowest overhead after connection — just 2 bytes per frame — while SSE adds about 5 bytes per message, and long polling requires full HTTP headers for each exchange. For 1000+ events/sec this matters a lot.

### Don't send full state — send diffs

If you have 1000 nodes and one changes, send the *one* change, not all 1000. Canonical pattern:

1. Client connects → server sends **initial snapshot** (REST or first WS message)
2. Server streams **deltas** from that point: `{ nodeId: "abc", status: "error", ts: 123 }`
3. Client applies deltas to its local state

Bonus: use **binary encoding** (MessagePack, Protobuf, FlatBuffers) instead of JSON if you're pushing >1k events/sec. Shaves 30–60% off payload size.

### Batching

Never emit a WebSocket frame per tiny event when traffic is heavy. Batch on the server side:
- Collect updates in a 16ms or 33ms window (1 frame at 60fps or 30fps)
- Send one frame with all the deltas
- Client applies them in a single paint cycle

This is the single biggest lever for scaling this kind of UI.

### Backend fan-out architecture

```
Node state changes
  ↓
EventBridge or SNS topic (or direct to Redis pub/sub)
  ↓
Fan-out layer (AppSync Events / Redis pub/sub / your WS servers)
  ↓
Connected clients subscribed to relevant channels
```

**Channel design matters.** Don't dump all 10,000 nodes' updates into one channel every client subscribes to. Instead:
- Channel per region / segment / customer tenant
- Or per "viewport" — clients subscribe only to nodes currently visible
- Or priority channels: critical alerts always, normal updates throttled

---

## Layer 2: Client-Side State

### The trap: re-rendering everything

Naive React:
```jsx
// BAD: every WS message re-renders the whole tree
socket.onmessage = (e) => setNodes(applyDelta(nodes, JSON.parse(e.data)))
```

With 1000 events/sec this will melt the browser. React's reconciler wasn't built for this.

### The pattern that actually works

**Decouple state from React's render cycle.** You want:

1. A **mutable state store** that receives updates instantly (no React involved)
2. A **render loop** (requestAnimationFrame) that reads from that store and paints
3. React only renders the chrome around the canvas (filters, sidebar, detail panel) — not the nodes themselves

Practical implementation:
- **Zustand** or **Valtio** with `subscribe` (not hooks) for direct subscriptions in your render loop
- Or just a plain JS object in a ref that gets mutated
- Or **SharedArrayBuffer** if you're really pushing it (lets your Worker and main thread share memory)

### The RAF coalescing pattern

```js
const pendingUpdates = new Map();
let rafId = null;

socket.onmessage = (e) => {
  const delta = parse(e.data);
  pendingUpdates.set(delta.nodeId, delta); // dedupe by id
  if (!rafId) rafId = requestAnimationFrame(flush);
};

function flush() {
  applyUpdates(pendingUpdates);
  renderer.draw();
  pendingUpdates.clear();
  rafId = null;
}
```

This gives you two huge wins:
- **Dedup**: if node `abc` changes 5x in one frame, you only render the final state
- **Frame-aligned**: you repaint at most once per animation frame (60 Hz)

### Use a Web Worker for parsing

If your message volume is high, parsing JSON on the main thread blocks rendering. Move the WebSocket + parsing to a dedicated Worker, use `postMessage` (or `SharedArrayBuffer` for zero-copy) to hand deltas to the main thread.

**OffscreenCanvas** lets you render in the Worker too — total separation from the main thread. Supported in all modern browsers.

---

## Layer 3: Rendering (The Big One)

### The hard ceiling: pick your tech by node count

| Tech | Max nodes (smooth) | Notes |
|---|---|---|
| **SVG / DOM** | ~500–1,000 | Each node is a DOM element. Dies fast. |
| **Canvas 2D** | ~10,000 | Solid for most use cases. Easy to debug. |
| **WebGL** | 100,000+ | GPU-accelerated. WebGL outstrips Canvas on performance, up to ten-fold. |
| **WebGPU** | 1,000,000+ | Future-proof, newer browsers only |

For your case (thousands of nodes, circuit-board style), **WebGL is the right answer**. Canvas 2D can work if you're ~2,000 nodes and careful, but WebGL gives you headroom.

### Libraries worth evaluating

**For circuit-board / DAG / fixed-layout style (what you described):**

- **PixiJS** — general-purpose 2D WebGL. Fast, well-maintained, great DX. My default recommendation. You draw sprites/graphics, manage scene graph, pan/zoom is straightforward.
- **Konva.js** — Canvas 2D with a nice API. Good for ~2k nodes; easier than PixiJS but slower.
- **reagraph** — React + WebGL network graphs. Good if your layout is graph-like.
- **deck.gl** — Uber's big-data WebGL lib. Overkill for 1k nodes but brilliant at 100k+.

**For force-directed / huge graphs:**

- **cosmos.gl** — GPU-accelerated force-directed graph layout that enables scalable and performant visualization of over one million nodes and links. Probably too specialized for a circuit board, but worth knowing.
- **Sigma.js** — WebGL graph viz, handles 10k+ nodes well
- **Cytoscape.js** — feature-rich, canvas-based, common in bioinformatics

**Don't use for this:**

- **React Flow / XYFlow** — great for <300-node DAG editors (like Zapier / n8n). Will struggle at 1000+.
- **D3 with SVG** — fine for charts, not for this.
- **Mermaid** — diagrams, not interactive boards.

### The techniques that actually get you to 60fps

**1. Viewport culling.** Only render nodes visible in the current viewport. A quadtree or spatial hash lets you query "what's in this rectangle" in O(log n). If only 200 of your 5000 nodes are on screen, you only draw 200.

**2. Level of detail (LOD).** When zoomed out, draw each node as a simple 4-pixel rect with a status color. When zoomed in, draw full icon + label + ports. Huge win — at 30% zoom, rendering fancy node graphics is wasted work.

**3. Dirty-region rendering.** If only 10 nodes changed this frame, redraw only their regions, not the whole scene. Easier in Canvas 2D than WebGL.

**4. Batched draw calls.** In WebGL, `drawArrays` once with instanced rendering beats 1000 separate calls. PixiJS does this for you if you use `ParticleContainer` and shared textures.

**5. Pre-render static content.** Connection lines between nodes rarely change — pre-render the grid/circuit lines to an offscreen texture once and composite on top. Only repaint the status layer.

**6. Throttle visual updates separate from data updates.** Your data might change 1000x/sec. Your pixels never need to change more than 60x/sec. Decouple them.

**7. Use CSS transforms for pan/zoom, not redraws.** If the underlying scene hasn't changed and the user just pans, just move the canvas with `translate3d` — the GPU does it for free. Only redraw on zoom level changes or when data updates.

---

## Layer 4: UX — The Actual Hard Part

Getting 1000 nodes on screen at 60fps is an engineering problem. Making a human understand them is a harder one.

### The hairball problem

Showing every node, every link, every status at once = visual noise that nobody can read. You are not a radar operator. Your users are not tracking 1000 things; they're looking for the *5 things that matter right now*.

When all your entities are heavily connected, the screen fills with nodes and links in a tangled mess that's impossible to read — usually from trying to show too much data at once. The fix: use filtering and ranking to surface what matters, not everything.

### Design principles for this kind of UI

**1. Status before structure.** At first glance, the user should see *how things are doing*, not *how they're wired*. Color is your best channel for status (red / amber / green + a "unknown/stale" grey).

**2. Pre-attentive cues for problems.** The eye catches motion, color, and size without conscious attention. Use these sparingly:
- **Steady color** = status
- **Pulse or glow** = recent change (fade out over 2–3 seconds)
- **Red ring** = needs attention *now*
- **Don't animate everything.** 1000 things pulsing is noise.

**3. Progressive disclosure.** Zoomed out: clustered regions with aggregate health ("12 nodes, 2 errors"). Zoomed in: individual node details. Click a node: side panel with full state, logs, actions.

**4. Mini-map + breadcrumbs.** Once you have >100 nodes you need orientation UI. A mini-map in the corner (showing the full board with a viewport rectangle) is table stakes for this kind of tool.

**5. Smart defaults / filters.** Default view should be "things I need to know about" — errors, warnings, recent changes. Make "show everything" an option, not the default.

**6. Search and jump.** Keyboard search (Cmd-K style) to find a node by name and fly the camera to it. For 1000+ nodes, scrolling is not navigation.

**7. Time scrubber.** For debugging: let the user scrub back 5 minutes to see *what the board looked like when the incident started*. This is a killer feature for ops/enterprise tools.

**8. Aggregation > enumeration.** "4 services degraded in us-east-1" is more useful than 4 red dots the user has to find.

### Visual language for a circuit board

- **Fixed grid layout** — circuit-board style implies stable positions. Don't force-direct; let users arrange once or define by data model.
- **Orthogonal routing** for connection lines (like PCB traces) — use a library like ELK or dagre for auto-layout, or compute Manhattan paths.
- **Port indicators** on each node — small colored dots at the edges showing input/output status.
- **Data flow animation** — dashed lines with animated strokes showing active connections (sparingly — one or two at a time, not all).
- **Hover tooltip** — name, status, last updated, key metrics. Appears with ~200ms delay.
- **Click = detail panel**, not modal. Modals trap users.
- **Dim the irrelevant.** When a node is selected or searched, fade everything else to 20% opacity. Focus is a gift.

### Animation rules for high-frequency updates

- Subtle beats dramatic. A 150ms color crossfade beats a flash.
- Coalesce rapid changes. If a node goes red→amber→red in 200ms, only show the final red. Users can't parse faster than ~200ms anyway.
- Respect `prefers-reduced-motion`. Some users get overwhelmed.
- Never animate more than ~10% of nodes simultaneously. If everything is moving, nothing is.

---

## End-to-End AWS Architecture

Here's what the stack looks like for a product doing this well:

```
  [Node state sources: agents, sensors, services]
                   ↓
          [EventBridge / SNS / SQS]
                   ↓
    ┌──────────────┴──────────────┐
    ↓                             ↓
[Aurora PostgreSQL]         [Redis (ElastiCache)]
  authoritative              hot cache + pub/sub
    ↓                             ↓
    └──────────────┬──────────────┘
                   ↓
   [AppSync Events / WS servers on Fargate]
                   ↓
          WebSocket connections
                   ↓
             [Browser clients]
                   ↓
       [Web Worker: parse + diff]
                   ↓
   [Main thread: RAF-batched renderer]
                   ↓
           [WebGL (PixiJS) canvas]
```

Key flows:
1. **Initial load**: REST → snapshot of current state (or first WS message with snapshot)
2. **Deltas**: WS stream of state changes, batched 16–33ms
3. **Write-through**: app writes to Aurora, publishes to Redis, fans out to clients

---

## Day 1 Action Plan for This Feature

Before writing "the real thing," de-risk the hard parts:

### Week 1: Spike the rendering
- [ ] Prototype with PixiJS: 5000 fake nodes, random status changes every 100ms
- [ ] Measure FPS on a mid-range laptop and a mid-range Android phone
- [ ] If < 60fps, try viewport culling; if still bad, try LOD; if still bad, reconsider scope
- [ ] Verify pan/zoom feels smooth

### Week 2: Spike the transport
- [ ] Stand up AppSync Events or a basic WS server on Fargate
- [ ] Push 1000 events/sec through it to a simulated client
- [ ] Measure end-to-end latency (backend write → pixel on screen)
- [ ] Target: p95 < 100ms from event origin to visible update

### Week 3: Design the delta protocol
- [ ] Define event schema (node_id, field changes, timestamp, version)
- [ ] Decide on JSON vs MessagePack vs Protobuf (start JSON, upgrade if needed)
- [ ] Build snapshot + delta reconciliation on the client (handle reconnects, missed events)
- [ ] Test dropped connections, out-of-order events, clock skew

### Week 4: UX skeleton
- [ ] Build the detail panel, mini-map, search, filters
- [ ] Test with real users on a fake board — can they find the broken node in <10 seconds?

### Don't skip
- [ ] **Load test with 10x your target node count.** If 1000 is the goal, test with 10,000. You'll hit the ceiling eventually.
- [ ] **Test on a bad network.** Throttle to 3G in Chrome DevTools. Does reconnection feel graceful?
- [ ] **Test on a bad device.** Mid-range Android phone, older Intel laptop. If it's janky there, it's janky for a real chunk of your users.

---

## Common Traps That Kill This Kind of UI

1. **Using React to render the nodes.** Tempting because familiar. Kills performance at this scale. Use React for chrome, WebGL/Canvas for the board.
2. **Sending full state on every update.** 1000 nodes × 1KB × 10 updates/sec = 10 MB/sec per client. Deltas or die.
3. **Not batching updates.** Every incoming event triggering a repaint = GPU thrash. RAF-coalesce.
4. **No backpressure.** If client can't keep up, it silently falls behind and users see stale data. Track lag and either drop old events, or signal "reconnecting..." to the user.
5. **No reconnect strategy.** WebSockets drop. Handle it. Exponential backoff, resync snapshot on reconnect.
6. **Single-channel fan-out.** One WS channel for all tenants = noisy neighbor problems and security risk. Namespace by tenant from day one.
7. **Over-animating.** Pulsing everything on every update = seizure-inducing noise. Animate meaningfully or not at all.
8. **No empty / loading / error states.** What does the board look like with 0 nodes? While loading? When the WS drops? Design those states explicitly.

---

## Libraries & Tools Cheat Sheet

**Rendering:**
- PixiJS (pixijs.com) — 2D WebGL, best general choice
- cosmos.gl (cosmograph.app) — massive graph viz
- reagraph (reagraph.dev) — React + WebGL graph
- Sigma.js — WebGL graph viz
- deck.gl — Uber's big-data viz
- Konva.js — Canvas 2D with a nice API

**Layout:**
- ELK (Eclipse Layout Kernel) — ports, orthogonal routing, great for circuit-style
- dagre — directed graph layout
- d3-force — force-directed layouts (not for circuit boards but worth knowing)

**State / transport:**
- Zustand, Valtio — lightweight state with direct subscriptions
- AWS AppSync Events — managed serverless WebSockets
- Redis pub/sub — classic fan-out
- MessagePack, Protobuf — binary encoding when JSON gets heavy

**Profiling:**
- Chrome DevTools Performance tab — flame chart, frame rate
- stats.js — FPS meter in the page
- `performance.mark()` / `performance.measure()` — custom timing

---

## The One-Sentence Summary

**Send deltas over WebSockets, store state in a mutable layer outside React, render with WebGL (PixiJS), coalesce every incoming update into one `requestAnimationFrame` paint, cull off-screen nodes, and design the UI so humans look at status and recent changes — not all 1000 things at once.**
