# My Work performance debug panel

The My Work performance debug panel is a temporary diagnostics surface for measuring why the My Work tab is slow or memory-heavy. It is not a product feature and must remain off by default.

## Enable

Use either explicit debug flag, then reload My Work:

```js
localStorage.setItem("mangorts.debug.myWork", "1");
location.reload();
```

or open the app with:

```text
?debug_my_work=1
```

When enabled, `MyWorkView` lazy-loads the diagnostics panel. When disabled, the panel module is not imported and the debug store does not subscribe to anything.

## Disable

Use the panel's `Disable debug` button, or run:

```js
localStorage.removeItem("mangorts.debug.myWork");
location.reload();
```

If debug mode was enabled through `?debug_my_work=1`, remove that query parameter as well.

## Off-path rule

Debug mode must stay effectively dead when disabled:

- no diagnostics panel is rendered
- no panel module is loaded
- no tree/stat walking for diagnostics
- no debug timers or debug subscriptions
- no `[MyWork]` console logging
- no repeated localStorage reads in hot render paths

The debug flag is resolved once when the debug helper module loads. Changing localStorage requires a reload.

## Metrics

- `active Home view`: the current Home view while the panel is rendered. For this panel it should be `my-work`.
- `restored Home view`: all localStorage keys beginning with `mangorts.app.home-view.v1`, which can explain why startup opens My Work automatically.
- `company` and `user`: shortened current IDs for correlating requests and cache keys.
- `scope` and `target users`: selected My Work scope and the number of users loaded for it.
- `cache`: current matrix cache key, hit/miss state, loading/stale/hasValue flags, age, cell count, failure count, and target user count.
- `matrix`: counts from the backend matrix payload, including root resources, total nested resources, project/logic gate/node counts, and max depth.
- `rows`: flattened My Work row counts and kind/depth totals after frontend row construction.
- `groups`: top-level grouping output counts and max depth.
- `fetch/cache`: matrix fetch or cache-load duration.
- `cells -> rows`: frontend matrix payload to row construction duration.
- `top grouping`: top-level grouping duration.
- `signature`: grouping signature duration used before default expansion recalculation.
- `default expand`: default expanded group computation duration.
- `render commit`: full matrix render-to-commit duration when React commits a debug-instrumented render.
- `cell filter/sort/group`: aggregate per-cell filtering, sorting, and grouping duration across the 24 role/priority cells.
- `slow cells`: the slowest role/priority cells by combined filter/sort/group time.
- `recent causes`: local mutation (`liveRefreshToken` is the local-mutation refresh signal), cache stale, cache fresh hit, and in-flight request joins. My Work no longer consumes realtime deltas or realtime refetch messages.
- `memory`: Chrome `performance.memory` values when available.

## Interpreting common findings

- Backend/cache fast but `render commit` slow: the bottleneck is likely recursive rendering, expansion breadth, or cell rendering work rather than the endpoint.
- `cells -> rows` slow: inspect row construction and tree flattening. The panel stores counts only, not row references.
- `top grouping` slow: the selected grouping stack or high row count is expensive before the 24 matrix cells render.
- `default expand` slow: expansion computation is walking a large group tree, or the grouping signature is causing frequent recomputation.
- High target user count: Team or All scope may be fanning out across many user-specific matrix loads.
- Restored Home view opens My Work on startup: remove only `mangorts.app.home-view.v1...` keys with the panel button or localStorage tooling.
- Memory grows after expansion: compare Chrome heap values before and after expanding groups, then use slow cells and render counts to narrow retained UI state.