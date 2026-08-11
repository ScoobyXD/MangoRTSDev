8/11/26

# MangoRTS Incident Summary: Company Explorer, RACI, Realtime, and Subscription Spam

## Root causes

### 1. Company Explorer reads performed database writes

Loading `/company-explorer/roots` or expanding a folder through `/company-explorer/children` ran a repair routine.

That routine:

1. Upserted the three default folders.
2. Started a backfill.
3. The backfill upserted the same three folders again.

This produced six updates per read.

The folder IDs, parents, names, and positions were normally identical. No meaningful business information changed. The same rows were repeatedly overwritten, with `updated_timestamp` being the main actual difference.

These were still real PostgreSQL writes. They created new internal row versions, wrote transaction data, and fired update triggers.

### 2. Fake folder updates caused company-wide RACI recalculation

The folder trigger fired whenever `parent_folder_id` appeared in an update statement. It did not check whether the old and new values were actually different.

Each fake folder update called a company-wide RACI synchronization function. That function looped through every Logic Gate in the company and recalculated its effective RACI audience.

The resulting chain was:

```text
Read Company Explorer
→ Update the same 3 default folders
→ Backfill updates the same 3 folders again
→ 6 folder triggers
→ 6 company-wide RACI passes
→ Every Logic Gate’s RACI is re-evaluated
```

The prepared RACI rows were not necessarily changed every time, but the expensive calculation still ran for every Logic Gate.

Duplicate browser requests could multiply this work further and contribute to API timeouts.

### 3. Two Company Explorer loaders were running

The correct Company Explorer uses lazy loading:

```text
/roots
/children
```

It loads only the rows currently needed by the visible tree.

Older Home and Project Management code still loaded the old workspace panel. It requested the complete folder collection twice:

```text
Node folders
Logic Gate folders
```

The database now has one unified folder tree, so those categories are obsolete. The backend effectively returned the same folder collection for both requests.

This caused duplicate, expensive permission-filtered folder queries during application startup, even on screens that did not display the Company Explorer tree.

React Strict Mode added more duplicate localhost requests because some root and board-list requests did not share requests already in progress.

### 4. Board subscriptions were managed as one disposable collection

The frontend subscribed to every currently loaded Logic Gate board inside one React effect.

When one Logic Gate entered or left the loaded set, React cleaned up the previous effect:

```text
One board changes
→ Unsubscribe every loaded board
→ Run the effect again
→ Resubscribe every loaded board
```

Pinned Logic Gates had similar behavior.

This produced repeated `realtime_subscription_accepted` logs for boards that had never actually stopped being relevant.

This was separate from the RACI recalculation bug, but the two could amplify each other. A RACI refresh could change the visible Logic Gate set, which could then restart all board subscriptions.

### 5. Huddle and KPI realtime audience resolution was incomplete

Huddle editor saves successfully wrote their data and realtime outbox event. Delivery then attempted to determine which users could receive the event.

The realtime audience resolver did not support Huddle Logic Gates or Huddle Nodes, so it returned `invalid`. The delivery worker incorrectly treated that as a temporary storage or backplane failure and repeatedly retried it.

KPI realtime events had a related identity problem. A KPI does not own an independent permission policy; its realtime audience must be resolved through its owning normal Logic Gate.

This caused repeated errors such as:

```text
failed to resolve current realtime audience
realtime_backplane_delivery_retry
```

## Required behavior

```text
Load Mango
→ Zero RACI recalculations

Read or expand Company Explorer
→ Zero database writes

Open RACI Tabs
→ Bounded read of already prepared rows

Change one Logic Gate
→ Recalculate only that Logic Gate

Change a folder
→ Recalculate only Logic Gates in the affected subtree

Add or remove one displayed board
→ Change only that board’s subscription

Save a Huddle resource
→ Resolve its direct Huddle audience successfully

Save a KPI
→ Resolve its audience through its owning Logic Gate
```

## Simplest corrective direction

1. Remove all repair and backfill work from `/roots` and `/children`.
2. Create default folders during explicit company initialization.
3. Place new Projects and Logic Gates during their creation commands.
4. Keep historical repair in explicit migrations or operator repair commands only.
5. Add `IS DISTINCT FROM` conditions so an upsert cannot update an identical folder.
6. Make folder triggers require an actual old-versus-new value change.
7. Delete the company-wide RACI loop from normal folder, group, and membership mutations.
8. Recalculate only the Logic Gates whose effective RACI could have changed.
9. Delete the obsolete Node-folder and Logic-Gate-folder workspace loaders.
10. Use `/roots` and `/children` only for actual Explorer trees.
11. Use specific Node, Logic Gate, Project, and RACI endpoints on non-tree screens.
12. Deduplicate root, child, and board-list requests already in progress.
13. Track board subscriptions individually and preserve unchanged subscriptions.
14. Add Huddle Logic Gate and Huddle Node audience resolution.
15. Resolve KPI realtime audience through its owning Logic Gate.

## Engineering moratorium

1. A read endpoint must not repair, initialize, backfill, upsert, or otherwise mutate business data.
2. Projection maintenance must be driven by real mutations, never ordinary reads.
3. An idempotent upsert must not update a row or timestamp when its meaningful values are unchanged.
4. A database trigger must compare old and new values before performing expensive work.
5. A row-level trigger must not start an unbounded company-wide loop.
6. Recalculation must be limited to resources that could actually have changed.
7. A change to one subscription must not destroy unrelated subscriptions.
8. A new data-loading path must replace the old path; both must not remain active.
9. Obsolete categories such as Node folders and Logic Gate folders must be deleted, not translated into compatibility behavior.
10. Tests must prove that reads produce zero writes and zero projection recalculations.
11. Tests must prove that changing one resource leaves unrelated projections and subscriptions untouched.
12. Request logs must distinguish requests whose query parameters select materially different behavior.