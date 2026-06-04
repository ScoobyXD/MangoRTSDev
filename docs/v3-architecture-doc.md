# V3 Architecture Notes

Status: historical scratch notes.

This file is not the source of truth for the V5 backend refactor. Use `docs/important tasks/v5-backend-refactor.md` for implementation direction.

Important terminology for V5:

- Use `subscription`, not `watching`.
- Use `WebSocket connection`, not a generic `stream`, when talking about the new realtime transport.
- Use `event table`, `event row`, and `event worker`, not a separate `outbox` concept.
- Do not implement from this file without checking the V5 tracker first.

Original notes start below.

I'm hand writting this

POST/PUT happens, backend already knows the hardcoded projection rule, and inside the same transaction it writes source + exact projection rows ->
find active subscribers whose scope matches ->
permission-check those specific users->
committed projection deltas are streamed live to the frontend ->
UI updates in place without refresh

===================================================
Which POST/PUTS are doing double writes for source of truth and projection tables
---------------------------------------------------

Scoped only to racio_matrix_projection_table, kanban_board_projection, and resource_permissions:

Count

16 POST/PUT paths are dual-write: source table + one/both projection tables in the same DB transaction.
0 POST/PUT paths write only the projection table.
2 PUT paths write permissions/access only: they update resource_permissions / default access, then publish visibility deltas. They do not rewrite stored RACI/Kanban projection rows.
1 POST path is source-only for this scope: creating a logic gate.
Dual-write paths
These write source-of-truth and projection rows together:

POST /v1/nodes: writes nodes + RACI projection.
PUT /v1/nodes/{nodeID}: writes nodes + RACI projection + Kanban projection if the node is on a board.
PUT /v1/logic-gates/{logicGateID}: writes logic_gates + RACI projection.
PUT /v1/logic-gates/{logicGateID}/raci: writes RACI assignment source rows + RACI projection.
POST /v1/logic-gates/{logicGateID}/raci/add: source + RACI projection.
POST /v1/logic-gates/{logicGateID}/raci/remove: source + RACI projection.
POST /v2/racio-matrix/nodes: conditional, but still source + projection. If assigning into a logic gate, it also writes Kanban projection.
POST /v2/racio-matrix/nodes/{nodeID}/move: source + RACI projection + Kanban projection.
POST /v1/work-items/logic-gate-assignments
POST /v1/work-items/logic-gate-assignments/move
POST /v1/work-items/logic-gate-assignments/remove
POST /v1/work-items/logic-gate-assignments/issue
POST /v1/kanban/cards
PUT /v1/kanban/cards/{cardID}
POST /v2/logic-gates/{logicGateID}/nodes
PUT /v2/logic-gates/{logicGateID}/nodes/{nodeID}/state
Those last Kanban/work-item paths write node_logic_gate_assignments / nodes, then update kanban_board_projection, then update racio_matrix_projection_table, all before commit.

---------------------------------------------------

For only node projection and logic gate projection:

Directly, there are 2 normal POST paths:

Add node information
Writes to:

source table: node_information
projection table: node_projection_table
Add logic gate information
Writes to:

source table: logic_gate_information
projection table: logic_gate_projection_table
So yes: those are dual writes.

here are 0 normal PUT paths that update these projection tables. Updating a node or logic gate itself does not update node_projection_table or logic_gate_projection_table.

There are also some indirect/delete-style POSTs that can touch them:

communications triage convert can add email info into node_information and node_projection_table
communications triage revert can delete node info and node projection rows
company explorer batch delete can delete node / logic gate source rows and clean their projection rows
So the simple answer:

Direct normal creates: 2 POSTs
PUTs: 0
Projection-only POST/PUTs: 0
Delete/cleanup POSTs that may touch them: 2 or 3, depending what object is being deleted/converted.

---------------------------------------------------
===================================================



===================================================
Are we actually doing precise delta changes for our projection tables
how exactly are we doing the projection table delta changes
---------------------------------------------------

For the projection tables we checked, the app is doing precise row-level changes, but not precise column-level SQL patches.

For Kanban:

When one node moves from one status/logic gate to another, it does not rebuild the whole Kanban table.

It does roughly this:

read the Kanban projection rows for that node before
update the source assignment row
update the node status fields
sync kanban_board_projection for that one node
read the Kanban projection rows for that node after
compare before vs after
send upsert / delete deltas
But the SQL does not say only:

update kanban_board_projection
set status = 'done'
where node_id = ...
It does an upsert for the affected projection row and sets the projected fields again: status, column, position, title, assignee, priority, due date, etc.

So it is:

precise row delta, not precise one-column patch.

For RACI/RACIO:

Same idea.

It does not rebuild the whole RACI projection table.

It syncs scoped rows:

for one node
or for one logic gate
or for the users affected by a logic gate RACI assignment change
Then it compares old rows vs new rows and emits upsert / delete deltas.

But again, the projection update is row-based. It rewrites the projected row fields, not just one changed column.

So the precise answer:

Whole-table rebuilds? I did not find whole-table rebuilds for Kanban or RACIO normal POST/PUT flows.
Row-level precision? Yes.
Column-level precision? No.
Frontend delta precision? It sends whole-row upsert / delete deltas, not “patch this one column.”
So if a node moves from Pending to Done, the affected Kanban row is precise, but the payload/update is basically:

“replace/upsert this card row with this new full row”

We send upsert / delete deltas to the frontend clients that are currently subscribed to that projection.

---------------------------------------------------

For that exact Kanban flow:

1. read the Kanban projection rows for that node before
2. update the source assignment row
3. update the node status fields
4. sync kanban_board_projection for that one node
5. read the Kanban projection rows for that node after
6. compare before vs after
7. send upsert / delete deltas
The dual write part is mainly:

2. update the source assignment row
3. update the node status fields
4. sync kanban_board_projection for that one node
That is the actual “write source + write projection” part.

The other steps are support work around that:

1. read before rows
This is not a write. It is just taking a snapshot so the backend knows what changed.

5. read after rows
Also not a write. It reads the new projection state after the dual write.

6. compare before vs after
This happens in Go memory. It creates the upsert / delete delta list.

7. send upsert / delete deltas
This is done after the DB transaction succeeds. The backend publishes those deltas to frontend subscribers.

So the simple split is:

HTTP handler:
- receives request
- checks auth/permission
- calls Go store/repo code
- after success, publishes deltas to live subscribers

Go store/repo transaction:
- reads old projection rows
- writes source tables
- writes projection table
- reads new projection rows
- compares old vs new
- returns the delta list

---------------------------------------------------

So the flow is:
Frontend browser
  sends HTTP request to

Go backend
  checks auth/permissions
  opens DB transaction
  sends SQL commands to

Postgres database
  reads/writes rows
  returns row data to

Go backend
  compares before vs after
  commits transaction
  sends HTTP response to browser
  publishes live deltas to subscribed browsers

---------------------------------------------------
why should go backend do before/after checks when doing dual writes

It needs before/after only to decide what to tell the live frontend afterward.

Split it like this:

To update Postgres:
  Go backend does not need before/after projection rows

To notify frontend precisely:
  Go backend uses before/after projection rows
Example: node moves from Logic Gate A to Logic Gate B.

To write the DB, backend can just do:

update assignment:
  logic_gate_id = B
  status = Pending
Then sync projection.

But to notify frontend, it needs to know:

old board A:
  delete card X

new board B:
  upsert card X
If it does not know the old projection row, it may not know which old board/card row to delete from the frontend.

That is where “before” matters.

Another example: RACI.

A RACI assignment changes. Backend can write that fine.

But for live UI updates, it needs to know:

which users had this row before?
which users have this row after?
If user A loses access:

send delete row to user A
If user B gains access:

send upsert row to user B
If user C still has access but row data changed:

send upsert row to user C
That is why before/after is useful.

So the precise answer is:

Before/after is not needed for the source/projection write itself.
Before/after is used to create correct live deltas, especially deletes and access changes.
If we did not care about live precise deltas, we could remove a lot of that before/after work.

---------------------------------------------------

POST/PUT go backend/postgresql round trip for before/after read/writes

EACH ONE OF THESE IS A GO BACKEND AND POSTGRESQL ROUND TRIP (and is just 1 HTTP request):

Browser -> Go backend
  1 HTTP request
Inside that one HTTP request, the Go backend may do:

Go backend -> Postgres
  read projection rows before

Go backend -> Postgres
  write source row

Go backend -> Postgres
  write projection row

Go backend -> Postgres
  read projection rows after


In more detail:

Browser -> Go backend
  1 HTTP request

Go backend -> Postgres
  BEGIN transaction

Go backend -> Postgres
  read projection rows before

Go backend -> Postgres
  update source assignment row

Go backend -> Postgres
  update node status fields

Go backend -> Postgres
  sync kanban_board_projection row

Go backend -> Postgres
  read projection rows after

Go backend
  compare before vs after in memory

Go backend -> Postgres
  COMMIT transaction

Go backend -> Browser
  HTTP response

Go backend -> subscribed browsers
  live delta event
---------------------------------------------------
===================================================



===================================================
POST/PUT authentication/access flow & and level 1 and 2 auth for all http requests
---------------------------------------------------

Level 1: Authentication / API access
Is this request from a real logged-in Mango user?
Is the token/session valid?
Do we know this user’s user_id?
Should this request be allowed into the app at all?

This protects the Go backend API from random outside requests.

It is not really “permission to request the database,” because the browser should never talk directly to Postgres. The browser talks to the Go backend. The Go backend talks to Postgres.

Then:

Level 2: Application authorization / resource permissions
This answers:

This is a real Mango user, but are they allowed to edit this specific thing?
Can they edit this node?
Can they move this Kanban card?
Can they change this logic gate?
Can they see this RACI row?
This is Mango’s own access logic: company membership, roles, resource permissions, RACI, default access, etc.

So the full flow is:

Frontend browser
  sends request with token/session

Go backend
  Level 1 check:
    is this a valid Mango user?

  Level 2 check:
    is this Mango user allowed to change this specific resource?

  if both pass:
    send SQL writes to Postgres

Postgres database
  stores the source/projection changes


I would not remove Level 2 checks from the Go backend.

The frontend can hide buttons, screens, and POST/PUT actions, but the frontend cannot be trusted as the authority. A user can still send a POST/PUT manually with curl, DevTools, a script, or a modified client.

---------------------------------------------------

Level 1: Authentication
This should exist for basically every protected app request.

It answers:

Is this a real logged-in Mango user?
Is their token/session valid?
What is their user_id?
For normal app API routes:

POST: yes
PUT: yes
GET: yes, if it returns private app data
DELETE: yes
Exceptions might be things like:

login
signup
health check
public assets
public invite/landing endpoints

Level 2: Mango Authorization
This does not mean the same exact check everywhere.

It answers:

This is a real user, does this Mango user have edit access to this thing?

GET private resource:
  allowed only if user has edit access

POST/PUT/DELETE private resource:
  allowed only if user has edit access


And there are only two practical resource outcomes:
edit access
no access
No separate view-only level.

dev_admin:
  edit access to everything

company_admin:
  edit access to everything inside that company

normal user:
  must pass Mango resource access rules

Because if there is no view-only, then “can see it” and “can edit it” are basically the same thing for protected resources.

---------------------------------------------------

Round tripping for 1 http requst:

For a normal non-admin user, a write request often becomes at least:

Browser -> Go backend
  1 HTTP request

Go backend -> Postgres
  SQL round trip 1:
  check resource_permissions / effective edit access

Postgres -> Go backend
  allowed / denied

Go backend -> Postgres
  SQL round trip 2:
  actually do the requested read/write/projection

Postgres -> Go backend
  result

Go backend -> Browser
  1 HTTP response
So:

Browser HTTP round trips: 1
Go backend <-> Postgres round trips: often 2+
And for the projection flows, it can be more than 2 database round trips because it may do:

permission check
read before projection rows
write source row
write projection row
read after projection rows
commit
Some of those can be combined, but conceptually yes: there are multiple Go-backend-to-Postgres interactions inside one HTTP request.

---------------------------------------------------

In our app, Level 1 is mostly not a Postgres permission lookup.

Current flow is more like this:

Frontend browser
  sends HTTP request with Authorization: Bearer <token>

Go backend
  Level 1 authentication:
    check token exists
    decode token
    verify token signature
    check issuer/client/token type
    check token is not expired
That token validation is mostly Go code + cryptography.

It does not normally ask Postgres:

"Is this token valid?"
The token is valid because it is signed by the auth provider.

There is one extra detail:

Go backend may need the public signing key
Those keys are cached. If the key is not cached, Go may fetch the key from the auth provider/JWKS endpoint. That is not Postgres.

Then the Go backend needs to turn the token into a Mango actor:

Who is this inside Mango?
What is their Mango user_id?
What company memberships do they have?
Are they dev_admin or company_admin?
For that, our app can hit Postgres, but it uses a short auth membership cache.

So Level 1 is really two pieces:

Level 1A: token validation
  usually no Postgres round trip

Level 1B: load Mango user + memberships
  Postgres round trip if not cached
  no Postgres round trip if cached
Then Level 2:

Level 2: resource access
  can this Mango user edit this node / logic gate / resource?
For normal users, that usually means Go backend asks Postgres:

Does this user have access according to resource_permissions / effective access rules?
For admins:

dev_admin or company_admin:
  Go backend can skip many resource-level checks
So the clean answer is:

Level 1 token check:
  usually 0 Postgres round trips

Level 1 Mango actor/membership load:
  0 Postgres round trips if cached
  1-2 Postgres round trips if not cached

Level 2 resource permission check:
  usually 1 Postgres round trip for normal users
  often 0 extra Postgres round trips for admins
So it is not automatically 2 database round trips every request, but for a normal uncached user doing a protected write, it can be:

1. Postgres round trip to load Mango user/memberships
2. Postgres round trip to check resource access
3. Postgres round trips to do the actual write/projection work

---------------------------------------------------
===================================================



===================================================
Obvious latency optimization:
---------------------------------------------------

Basically we are doing a crap ton of back forth between Go backend and database for one HTTP request. 

For the Kanban flow, inside one browser request, the Go backend talks to Postgres multiple times:

Browser -> Go backend
  1 HTTP request

Go backend -> Postgres
  BEGIN transaction

Go backend -> Postgres
  read projection rows before

Go backend -> Postgres
  update source assignment row

Go backend -> Postgres
  update node status fields

Go backend -> Postgres
  sync kanban_board_projection row

Go backend -> Postgres
  read projection rows after

Go backend
  compare before vs after in memory

Go backend -> Postgres
  COMMIT transaction

Go backend -> Browser
  HTTP response

Go backend -> subscribed browsers
  live delta event
So yes: each SELECT, INSERT, UPDATE, DELETE, or COMMIT is usually a Go-backend-to-Postgres call and Postgres response.

So obviosuly these dont take up as much time as other stuff, but later down the line it'd be nice to make this much much cleaner and minimize back and forth for level 2 auth (maybe even level 1 when user info is not cached) and for before/after reads and double writes, also the begin/commit transaction.

---------------------------------------------------
===================================================



===================================================
this is under progress right now so will likely change....
After double write how we are pushing out the delta changes from projection table to ui
---------------------------------------------------

The async publish work has a few lanes:

Lane 1: Workspace events
These are general app events like:

node changed
logic gate changed
Kanban card changed
folder item changed
They go to /v1/workspace/stream as:

event: workspace
These are more durable. The stream can catch up from stored domain events if it missed something.

Lane 2: Projection deltas
These are the precise projection row changes:

upsert this Kanban card row
delete this RACIO row
They also go through /v1/workspace/stream, but as:

event: projection
Before sending them, the Go backend:

finds active subscribers
checks whether each user is allowed to receive that row
groups deltas by stream scope
assigns a projection sequence number
pushes the payload to the matching open stream

Lane 3: Notifications
Some domain events become notifications.

Example:

text


user was assigned
user was mentioned
RACI assignment changed
Those go to notification storage, then to the notification stream:

text


/v1/notifications/stream
event: notification
text


Lane 4: Derived workspace events
Some events may create follow-up workspace events. That is another async projector.

So your log line:

text


GET /v1/workspace/stream status=200 ...
is the stream connection itself.

That stream can carry:

text


event: ready
event: ping
event: workspace
event: projection
It is not one HTTP request per delta. It is one open SSE connection, and the backend pushes many events through it.

-----------------------------------------------------------

Yes, your concern is right. The current shape is reasonable for early product scale, but I would not design the million-user version around:

for every active user:
  query DB permission
  decide whether to send
That becomes expensive fast.

Recommended Architecture
Use this mental model:

1. Command API
2. Source-of-truth write
3. Projection write
4. Outbox event
5. Event broker
6. Realtime gateway
7. User/browser stream
In simple terms:

Frontend
  sends POST/PUT

Go API backend
  checks auth
  checks permission for the command
  writes source tables
  writes projection tables
  writes durable outbox rows
  commits
  returns response

Outbox worker / broker
  reads committed outbox rows
  publishes events by scope

Realtime gateway
  sends events only to connected users subscribed to that scope
The key change is:

The POST/PUT request should not personally fan out to every browser.
It should write the durable facts and outbox records, then a separate delivery system handles live push.

One Stream
I would move toward one live connection per browser tab/session, not many streams.

That stream can carry different message types:

workspace.event
projection.delta
notification.created
permission.revoked
permission.granted
snapshot.invalidate
So putting projection deltas on /workspace/stream is not inherently wrong. Multiplexing event types over one stream is normal.

What is confusing is the naming. I would separate concepts:

Snapshot endpoint:
  GET current state

Realtime stream:
  receive changes after snapshot
So the client flow should be:

1. GET snapshot
2. open stream from snapshot sequence/cursor
3. apply live events
4. if stream misses too much, refetch snapshot
Avoid Per-User Fanout Checks
Do not do this at scale:

for every active user on board X:
  DB check logic_gate access
  DB check node access
  send or skip
Better rule:

authorize at subscription time
publish by scope
only deliver to sockets already authorized for that scope
Example:

User opens Kanban board X

Realtime gateway:
  checks once:
    can user access board X?
  if yes:
    subscribe socket to board:X
Then when a card changes:

event broker publishes to board:X
gateway sends to sockets subscribed to board:X
No DB check per event per user.

If permissions change later:

publish permission revoked/granted event
gateway/client removes affected data or refetches
For User-Specific Data
Some projections should be user-scoped.

RACIO is a good example:

racio:user:123
If the row belongs only to user 123, publish it only to:

user:123
Do not publish broadly and then filter every user.

Outbox
Yes, outbox is the right direction.

Inside the same DB transaction as the source/projection write, insert rows like:

outbox_events:
  event_id
  company_id
  stream_name
  scope
  sequence
  event_type
  payload
  created_at
Then a worker reads those rows and publishes them.

This solves the dangerous problem:

DB commit succeeded but live publish failed
With outbox:

DB commit succeeds
outbox row exists
worker can retry until delivered
Sequencing
Keep sequence numbers, but scope them.

Do not require one global sequence for everything.

Use sequences like:

company:{company_id}
board:{board_id}
user:{user_id}
racio:user:{user_id}
notifications:user:{user_id}
Client reconnects with:

last_sequence
Then backend/broker can replay missed events for that scope.

Scale Recommendation
The scalable version is:

Postgres:
  source of truth
  projection tables
  outbox table

Broker:
  Kafka / Kinesis / NATS / Redis Streams / Pub/Sub

Realtime gateway:
  WebSocket or SSE fleet
  manages active browser connections
  subscribes to broker topics/scopes

Clients:
  one stream connection
  snapshot + cursor + live events
Use topic/scope partitioning like:

company_id
board_id
user_id
That keeps ordering local and lets the system scale horizontally.

Concrete Principle
The big principle should be:

Do authorization before accepting a subscription.
Do not repeatedly authorize every event for every user.
And:

Use user-scoped streams when visibility is user-specific.
Use shared scoped streams only when all subscribers are allowed to see the payload.
My Recommendation
For Mango specifically, I would move toward:

1. Keep source/projection writes in the API transaction.
2. Add a durable outbox table.
3. Put projection deltas, workspace events, and notification events into outbox.
4. Use one realtime stream per browser session.
5. Use scoped subscriptions: company, board, node, logic_gate, user.
6. Authorize subscription once.
7. Publish permission changes as first-class events.
8. Stop doing DB permission checks per active user per delta.
That is the coherent architecture I’d aim for.

References: AWS describes the transactional outbox pattern for reliable event publishing after DB writes, PostgreSQL supports logical decoding/CDC if you later want DB-change streaming, and Kafka-style partitioned logs are a common way to scale ordered event delivery by scope.
Sources: AWS transactional outbox, PostgreSQL logical decoding, Apache Kafka docs.

-----------------------------------------------------------

Vocabulary

Snapshot
  A normal GET response.
  It means: "give me the current state right now."

Stream
  A long-lived connection that sends messages after the snapshot.
  It means: "tell me what changes after I loaded."

Connection
  The actual network link between browser and Go backend.
  In our app today, this is SSE, not WebSocket.

SSE
  Server-Sent Events.
  Browser opens one HTTP connection, backend keeps sending events down it.

WebSocket
  Different transport. Two-way persistent connection.
  We are not required to use WebSockets just because we say "live updates."

Subscription
  What the browser says it wants updates for.
  Example: "I am looking at board X" or "I am looking at node Y."

Delta
  A small update message.
  Example: "upsert this card" or "delete this row."

Event
  An internal durable fact that something happened.
  Example: "node status changed" or "user was assigned to logic gate RACI."
So I should not say “socket” unless I mean the actual connection. Better vocabulary:

SSE connection = transport
stream = messages flowing over that connection
subscription = resource scope the browser is watching
event = internal fact
delta = UI update message
notification = user-facing alert
Snapshots vs Streams
They should be separate concepts.

Snapshot GET:
  user opens board X
  backend checks access
  backend returns current board rows + version/cursor

Live stream:
  browser says "I am subscribed to board X"
  backend sends future changes for board X
So:

GET snapshot = initial truth
stream deltas = keep it fresh
If /v1/workspace/stream currently carries projection deltas, that is not necessarily wrong. But the name is confusing. It is not a snapshot stream. It is a realtime stream.

Better naming would be:

GET /v1/workspace/snapshot
GET /v1/realtime/stream
Do We Need Events?
Yes, but mostly as internal backend facts.

We do not need to show “events” to the frontend for everything.

We need events because they answer:

What happened?
Should we notify anyone?
Should we publish a live delta?
Can we retry if live publish fails?
Can we replay missed messages?
The event comes from the successful source-of-truth change.

Example:

User moves node from Pending to Done

Go backend writes DB
Go backend records internal event:
  node_status_changed
That event can produce:

live UI delta:
  update board X for people currently looking at board X

notification:
  notify relevant RACI users if this is notification-worthy
Two Buckets
Your simplified split is right:

Bucket 1: people currently looking at the UI
Bucket 2: people who should receive notifications
I would design around exactly that.

Bucket 1: Live UI Updates
Flow:

User opens Kanban board X

Frontend:
  GET board X snapshot

Go backend:
  checks user has edit access to board X
  returns current board state

Frontend:
  subscribes to board X on the realtime stream

Go backend/realtime layer:
  records: this connection is watching board X
Then when board X changes:

Go backend:
  publishes delta to scope board:X

Realtime layer:
  sends delta only to connections subscribed to board:X
No per-user DB permission check on every delta.

Why?

Because:

If the user is subscribed to board:X,
they already passed the access check when they opened/subscribed.
The only caveat:

If permissions change while the stream is open,
we need to revoke/refresh subscriptions.
That can be handled with:

permission.revoked event
permission.granted event
force client refetch
or close that resource subscription
Bucket 2: Notifications
Notifications should not be based on “who is looking.”

They should be based on:

Did something notification-worthy happen?
Who should be notified?
Your notification-worthy list:

node in logic gate changed status
node assigned to you
node priority changed
node due date changed
you were assigned to logic gate RACIO
Flow:

Go backend records event:
  node_status_changed

Notification worker:
  asks:
    is this event notification-worthy?

  if yes:
    resolve recipients from the relevant logic gate RACIO / assignment rules

  writes notification rows

  if recipient has notification stream open:
    push notification live
So live UI updates and notifications are separate:

Live delta:
  only users currently looking at the resource

Notification:
  users who need to know, even if not looking
Recommended Cohesive Design
I would aim for this:

1. Frontend loads page with GET snapshot.
2. Frontend subscribes to resource scope on one realtime SSE connection.
3. Go backend authorizes snapshot/subscription once.
4. POST/PUT writes source + projection.
5. Same DB transaction writes outbox messages.
6. Realtime worker publishes resource-scoped deltas.
7. Notification worker processes notification-worthy events.
8. Permission changes publish revoke/refetch messages.
Scopes should be resource-based:

company:{company_id}
board:{board_id}
node:{node_id}
logic_gate:{logic_gate_id}
user_notifications:{user_id}
racio_user:{user_id}
The big rule:

Do not fan out by asking the database about every active user.
Fan out by resource subscription.
So for board updates:

publish to board:X
only browsers watching board:X receive it
For notifications:

write notification rows for specific users
publish to user_notifications:user_id
That gives you a scalable split:

Resource live updates = active viewers only
Notifications = specific recipients only

-----------------------------------------------------------

No, not every GET should load the whole workspace snapshot.

Better:

GET = load the current resource/screen you asked for
So if user opens a Kanban board:

GET Kanban board snapshot
If user opens a node editor:

GET node snapshot
If user opens RACIO:

GET RACIO snapshot
A “snapshot” just means:

the current state for that screen/resource
It does not have to mean:

the whole workspace
So vocabulary:

Workspace snapshot:
  whole or large workspace state

Resource snapshot:
  current state for one screen/resource
Usually we want resource snapshots, not always full workspace snapshots.

Do We Open A Stream For Every GET?
No.

Open a live subscription only when the screen needs live updates.

Example:

Kanban board:
  yes, subscribe to board:X

Node editor:
  yes, subscribe to node:X if collaborative/live updates matter

RACIO matrix:
  yes, subscribe to racio:user:X or logic_gate:X depending design

Settings page:
  maybe no

Static lookup list:
  maybe no

One-time form submit:
  no
So the rule is:

GET loads data.
Subscription keeps it fresh only if freshness matters.
When Turn Streams On/Off?
Ideally:

One SSE connection per browser tab/app session
You do not keep opening/closing the physical SSE connection for every page.

Instead:

Open SSE connection when app starts/logs in.
Close SSE connection when app closes/logs out.
Then inside that connection, the frontend changes subscriptions.

Example:

User opens Kanban board A:
  subscribe board:A

User navigates to Kanban board B:
  unsubscribe board:A
  subscribe board:B

User opens node editor C:
  subscribe node:C

User closes node editor C:
  unsubscribe node:C
So:

Connection stays open.
Subscriptions change.
What Turning It On Looks Like
Current simple version could be query params:

GET /v1/realtime/stream?company_id=123&projection=kanban_board&board_id=abc
That opens a stream already subscribed to board abc.

Better future version:

Open one stream:
GET /v1/realtime/stream?company_id=123
Then frontend sends subscription changes through a separate small POST endpoint:

POST /v1/realtime/subscriptions
{
  "subscribe": ["board:abc", "node:def"],
  "unsubscribe": ["board:old"]
}
But SSE is one-way, so the browser cannot send subscribe/unsubscribe messages through the SSE connection itself. With SSE, subscription changes need either:

new stream URL
or:

separate POST requests to update subscription state
If we used WebSockets, the client could send subscribe/unsubscribe over the same connection.

Practical Recommendation
For now, I would not overcomplicate.

Use this:

GET resource snapshot when opening a screen.
Open one SSE stream for that screen/resource.
Close it when leaving that screen.
Then later improve to:

one app-wide realtime connection
resource subscriptions managed separately
So the clean answer:

No, every GET should not load a full workspace snapshot.
GET should load the relevant resource snapshot.
Live stream/subscription should exist only for screens that need live updates.
The stream connection can be long-lived, but subscriptions should match what the user is currently viewing.

-----------------------------------------------------------

Yes: one realtime connection per browser tab / app session / logged-in user.

More exact:

One open realtime connection
per browser tab
per logged-in Mango user
per company context
If the same user opens Mango in 3 tabs, that is usually:

3 realtime connections
That is normal.

SSE vs WebSocket
SSE:

browser -> backend:
  normal HTTP requests only

backend -> browser:
  live stream events
Good when the server mostly pushes updates.

WebSocket:

browser <-> backend:
  both sides can send messages over the same connection
Good when the browser needs to frequently send live messages like:

watch board X
unwatch board Y
presence
typing
collab cursor
For Mango, WebSocket may fit better if we want one connection and dynamic “watching” updates.

But SSE can still work if we keep things simple.

Use “Watching,” Not Subscription
Good call. Let’s use:

watching
Instead of “subscription.”

So:

User is watching board X.
User is watching node Y.
User is watching RACIO matrix.
Should We Start Realtime Immediately?
Yes, I agree with this principle:

When user logs into Mango, start realtime immediately.
Do not wait for the user to manually request live updates.

Flow:

User logs in / app loads

Frontend:
  opens one realtime connection

Go backend:
  validates user
  validates company access
  starts sending live messages
Then the frontend tells backend what it is currently watching.

If using WebSocket:

browser opens WebSocket

browser sends:
  watch company overview
  watch node X
  watch board Y
  unwatch board Z
If using SSE:

browser opens stream URL with watch parameters
But if watches change a lot, SSE is clunkier.

Important Distinction
We should not make the user watch everything by default.

This is too broad:

always send all node, logic gate, Kanban, RACIO changes for the company
That can explode at scale.

Better:

Realtime connection starts immediately.
But watched scopes are based on what the UI actually has open.
Example:

User is on home/company explorer:
  watching company explorer summary

User opens Kanban board A:
  watching board:A

User opens node detail N:
  watching node:N

User opens RACIO:
  watching racio:user:currentUser
So the user always has realtime available, but the backend only pushes relevant scopes.

Permission Revocation
Yes, this needs first-class handling.

If user loses access to board/node/logic gate:

Go backend emits permission_revoked

Realtime layer:
  removes that watching scope for that connection
  sends frontend:
    remove this data / navigate away / refetch
Unified Realtime Connection
The goal:

One realtime connection carries many message types.
Messages might look like:

{
  "type": "projection.delta",
  "scope": "board:abc",
  "sequence": 124,
  "deltas": []
}
{
  "type": "notification.created",
  "scope": "user:123",
  "notification": {}
}
{
  "type": "permission.revoked",
  "scope": "node:def"
}
So yes:

one stream/connection
multiple watched resources
multiple GET snapshots
all tied together by scope + sequence
My Lean Recommendation
For where Mango is heading, I would seriously consider WebSockets.

Use:

GET snapshots for current state
WebSocket for live changes
Then:

on login:
  open WebSocket

on page open:
  GET resource snapshot
  send "watch resource" over WebSocket

on page close:
  send "unwatch resource"

on permission loss:
  backend forces unwatch + sends permission revoked
That is cleaner than repeatedly opening different SSE streams.

--------------------------------------------------------

Yes, subscriptions should be how we tell what UI resource the user is actively looking at.

Use two buckets:

Bucket 1: Live UI updates
  "Which browser tabs are currently subscribed to this resource?"

Bucket 2: Notifications
  "Which users should be alerted because this event matters to them?"
Those are different.

Active UI Looking
We cannot know if the user’s eyes are literally looking at the screen.

But we can know:

This browser tab has this screen/component open.
That is good enough.

Example:

User opens Kanban board A

Frontend:
  GET board A scoped snapshot
  WebSocket message: subscribe board:A

Backend:
  checks user has edit access to board A
  records this connection as subscribed to board:A
Then if board A changes:

Backend:
  sends live delta only to connections subscribed to board:A
No notification logic involved.

Snapshots
I agree with your snapshot rule:

Whole company snapshot:
  first login
  manual refresh / hard recovery

Scoped snapshot:
  normal navigation after that
So:

Open app:
  GET company/user bootstrap snapshot

Open node:
  GET node snapshot

Open logic gate:
  GET logic gate snapshot

Open Kanban board:
  GET board snapshot

Open RACIO:
  GET RACIO snapshot
Then WebSocket keeps those scoped views updated.

WebSocket Shape
Yes, I think WebSockets fit this better than SSE.

One WebSocket connection:

one browser tab
one logged-in user
one company context
Over that one connection, the frontend sends:

{ "type": "subscribe", "scope": "board:abc", "after_sequence": 123 }
{ "type": "unsubscribe", "scope": "board:abc" }
Backend sends:

{ "type": "projection.delta", "scope": "board:abc", "sequence": 124, "deltas": [] }
{ "type": "notification.created", "scope": "user:123", "notification": {} }
{ "type": "permission.revoked", "scope": "node:def" }
Permission Rule
Subscription does not grant permission.

Flow:

Frontend asks to subscribe to board:A

Backend:
  check user has edit access to board:A

If yes:
  add connection to board:A subscribers

If no:
  reject subscription
Then normal board deltas can go straight to board:A subscribers without checking every user every time.

If permissions change:

permission change event happens

Backend:
  re-check affected active subscriptions
  remove users who lost access
  send permission.revoked / delete/refetch message
That check is okay because permission changes are rarer than normal UI updates.

Notifications
Notifications should not depend on whether the user is subscribed to the UI.

Notification logic should ask:

Did a notification-worthy event happen?
Who should receive it?
Your notification list:

node in logic gate changed status
node assigned to you
node priority changed
node due date changed
user assigned to logic gate RACIO
Then:

write notification rows for those users
push live notification if their WebSocket is connected
Refactor Size
This is a medium-to-large refactor, but not a full rewrite.

Keep:

existing GET endpoints
source-of-truth writes
projection table writes
before/after delta generation
notification rules mostly
Replace or reshape:

SSE stream handling
workspace/projection/notification stream hubs
frontend stream client
live delivery routing
subscription state tracking
Add:

WebSocket endpoint
connection manager
subscription manager
scope authorization
message protocol
reconnect/resume handling
permission revoke handling
event/outbox worker if we want durability
So no, we do not rip out the database/projection system. The main replacement is the live transport and routing layer.

Best phased path:

1. Keep current writes/projection deltas.
2. Add WebSocket connection.
3. Move projection deltas onto WebSocket.
4. Move notifications onto WebSocket.
5. Add subscribe/unsubscribe scopes.
6. Later add outbox/broker for scale.
That lets us migrate without replacing everything at once.
