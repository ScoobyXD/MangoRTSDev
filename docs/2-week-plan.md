# Historical: Two Week Plan

This document is retained as product and planning history. For current MangoRTS AWS dev platform work, start at `docs/README.md`.

# Two Week Plan

## Objective
Ship a production-lean first release with a browser frontend, a real backend, secure cloud basics, and end-to-end flow coverage for critical user journeys.

## Product philosophy and operating thesis
MangoOS is a real-time operational system for enterprise work, inspired by real-time strategy interfaces.
The core belief is that company work is sequential and algorithmic, and can be modeled as ordered logic gates with explicit state transitions.
The product unifies communication, work context, and execution in one operational surface so teams do not depend on fragmented tools.
The system analogy on what an RTS is: An internal Bloomberg terminal on steroids with video game ui.

### What this system is replacing
- Scattered context across chat, email, and disconnected work tools.
- One-dimensional notification streams with poor ownership visibility.
- Manual status handoffs that hide blockers and dependencies.

### What this system must provide
- One canonical home for each piece of work.
- Explicit process states, ownership, and dependencies.
- Real-time visibility of what is happening now, what is blocked, and what should execute next.
- Full history of operations and state changes for auditability and learning.

## Canonical terminology for this project
Use the following terms in requirements, design, and implementation artifacts.

### Core primitives
1. Node.
2. Logic Gate.
3. Message.
4. Operation.
5. Execute (verb for commanding an operation).

Flow is not a primitive. Flow is a structure composed from connected logic gates.

### Node terminology note
For a node currently inside a logic gate, use both terms until naming is finalized:
- This is an operation because for an operation to take place, it needs the piece of work and mechanism to do them on.

Implementation note: maintain compatibility fields or aliases for both names in design documents and interface contracts until the final naming decision is made.

### Message semantics
- Not every message creates a node.
- Not every message creates a logic gate.
- Every message should be linkable to a node, a logic gate, or both.
- Recommendation systems for automatic linking are explicitly later-stage work.

### Operation semantics
A successful execute command should produce one or more of the following effects:
- Add, remove, or update information on a node.
- Change logic gate state.
- Move a workpiece or dimension to the next logic gate.
- Emit timeline and audit records.
- Update subscribed user interface modules in real time.

### Logic Gate status language
Use this baseline state vocabulary:
- Idle (open to take work).
- Loaded (work accepted, pending processing).
- Blocked (waiting on dependency).
- Processing (actively executing operation, this is the only point in time an operation happens).
- Output Ready (finished and ready to hand off).
- Failed (execution failed and needs intervention).

### Required Logic Gate definition fields
Each logic gate must define:
- Input contract.
- Output contract.
- Acceptance rules.
- Failure rules.
- Retry and escalation behavior.
- Edit history.

## User interface architecture direction
The user interface is a customizable module canvas.
Users can create, move, resize, and configure modules, then build saved views from those modules.
This is a design requirement, not an optional enhancement.

Required module families for architecture planning:
- Node Tree module.
- Logic Gate module.
- Message module.
- Inventory module.
- Operation execution module.

## Composable modeling as a core feature
The platform must function as a composable building system, similar to lego bricks for enterprise operations.
This is a core product requirement.

### Composable Node modeling requirements
- Users must be able to create nodes quickly.
- Users must be able to define parent-child relationships between nodes.
- Users must be able to link peer nodes to represent dependencies, references, and shared context.
- Users must be able to add, remove, and update node relationships without destructive data loss.

### Composable Logic Gate modeling requirements
- Users must be able to create logic gates visually.
- Users must be able to link logic gates into ordered and branching process networks.
- Users must be able to edit logic gate relationships over time while preserving history.

### Node to Logic Gate linkage requirements
- Users must be able to assign workpieces or dimensions into logic gates.
- Users must be able to view where each node currently resides in the logic gate network.
- Users must be able to move workpieces or dimensions through logic gates using execute operations.

### Why this is strategically important
- It converts tribal process knowledge into explicit, searchable, and editable system logic.
- It creates a visual and auditable representation of company workflows.
- It prepares companies for reliable automation and future agent execution.

### Repetitive workflow automation direction
- Frequently repeated work should be schedulable as reusable node and logic gate templates.
- Scheduled executions should instantiate new workpieces or dimensions and route them through predefined logic gate paths.
- Automation should start with human-supervised execution, then progress to agent-led execution with policy controls.

### Management optimization value
A complete visual of logic gate networks and workpiece or dimension movement enables leadership to:
- question every requirement,
- remove unnecessary steps,
- simplify and speed up operations,
- reduce blockers and handoff failures,
- continuously improve process design based on observed system behavior.


### Measurement and management intelligence requirements
The platform must make quantitative management visible and actionable:
- Measure inputs, outputs, throughput, cycle time, blocker duration, and completion quality by logic gate and by team.
- Measure productivity trends across workpieces or dimensions and process stages.
- Measure operation success and failure rates, retries, and escalation frequency.
- Maintain list-based standard operating procedures linked to real execution paths.
- Compare pre-change and post-change performance to determine net positive or net negative impact.
- Provide real-time organization-wide status visibility so management can act without waiting for reports.

### Why this is useful for agents
Agents require structured context, explicit process state, and measurable outcomes to operate reliably.
This architecture provides exactly that:
- Nodes plus logic gates define clear objectives and dependencies.
- Operations and execute events provide deterministic state transitions.
- Message linkage keeps communication context connected to work state.
- Measurements and historical outcomes provide feedback loops for planning, policy tuning, and autonomous execution confidence.
- Standard operating procedures become executable workflows that agents can follow, validate, and improve over time.

## Scope lock
- Keep one frontend service and one backend service for week one delivery speed.
- Keep one relational database cluster.
- Keep one cache cluster only if measured hot path latency requires it.
- Keep one object storage bucket for attachments.
- Keep one container orchestration platform.
- Avoid multi-region, Kubernetes, and advanced streaming in this first release window.

## Canonical database schema decision (locked)
- The **only** schema to implement for Aurora PostgreSQL is: `docs/aurora-postgresql-schema.md`.
- Treat `backend/db/schema.sql` as legacy bootstrap SQL for old case tables and do not use it for the new production model.
- All migrations, seed scripts, repository code, and API contracts must map to:
  - `nodes`
  - `node_relationships`
  - `node_information`
  - `node_projection_table`
  - `logic_gates`
  - `logic_gate_relationships`
  - `logic_gate_information`
  - `logic_gate_projection_table`
  - `operations`
- Tenant isolation is still required via `company_id` on every table path.

### Existing Aurora cluster guidance
- If the current Aurora cluster is healthy and empty, **do not delete it just to start over**.
- Reuse it and apply the canonical schema from `docs/aurora-postgresql-schema.md`.
- Recreate only if there is a hard misconfiguration you cannot safely fix in-place (wrong VPC/subnets/security controls/engine setup).
- Terraform and Docker are optional sequencing choices for now:
  - Terraform helps you standardize and reproduce infra.
  - Docker helps you package and deploy services.
  - Neither is required to run SQL migrations against an already running Aurora cluster.

## Microservice-first compromise
To satisfy early service boundaries without heavy overhead:
- Create two backend services from day one:
  1. case-api (authoritative write and read service for case data)
  2. search-api (index and search read service)
- Run both services in the same repository and same cloud account.
- Share a small common package only for contract types, not business logic.

## Biggest gaps to close first
1. Replace the in-memory repository with a relational database repository.
2. Add authentication and authorization middleware.
3. Add tenant scoping key to every business table and every query path.
4. Add audit log table and sensitive action event writes.
5. Add structured logs, metrics, and service health dashboards.
6. Add end-to-end tests for critical user journeys before production deploy.

## Day-by-day execution

### Day 1
- Freeze product scope and critical flows.
- Confirm relational contracts for node, logic gate, relationship, information, and operation primitives.
- Confirm service contracts for case-api and search-api.

### Day 2
- Create environment files and local container compose.
- Add health checks and baseline structured request logging.
- Add database migration folder and first migration that creates the canonical Aurora schema from `docs/aurora-postgresql-schema.md`.

### Day 3
- Implement relational database repository for the canonical node and logic gate schema.
- Keep in-memory repository for fast local demos and tests.
- Add create and read endpoints backed by canonical relational persistence.

### Day 4
- Add artifact add and artifact delete endpoints with activity logging.
- Add child case creation and parent activity logging.
- Add strict request validation and clear error responses.

### Day 5
- Add authentication middleware and role checks.
- Enforce tenant scoping (`company_id`) on every query and mutation path.
- Add audit log table for sensitive actions.

### Day 6
- Implement simple search-api with index table and query endpoint.
- Add asynchronous index update job from case-api events.
- Add retry strategy for failed index updates.

### Day 7
- Connect frontend case module to case-api endpoints.
- Connect frontend search interactions to search-api endpoint.
- Add optimistic updates only where rollback is safe.

### Day 8
- Add object storage upload flow for artifact attachments.
- Store object metadata in relational tables.
- Add signed upload and signed download paths.

### Day 9
- Add end-to-end tests for top five flows:
  1. create case
  2. create child case
  3. add artifact
  4. delete artifact
  5. find case through search and open details

### Day 10
- Add deployment pipeline with:
  - lint and type checks
  - backend tests
  - end-to-end critical path tests
  - staging deploy
  - production deploy gate

### Day 11
- Add latency and error dashboards.
- Add alerts for error rate and service unhealth.
- Add budget alarms and resource tags.

### Day 12
- Run lightweight load test for critical reads and writes.
- Tune slow database queries and add missing indexes.
- Add cache only if measured query hot spots exist.

### Day 13
- Write incident runbook and rollback instructions.
- Write security and compliance baseline checklist and confirm all items.
- Freeze release candidate.

### Day 14
- Final production validation.
- Launch with strict change freeze for twenty four hours.
- Monitor metrics and close highest impact issues first.

## Observability and incident operations
You cannot run production blind. The following are mandatory foundations:

### Mandatory observability pillars
1. Structured logging with correlation identifiers so each request can be traced across services.
2. Metrics for latency, error rates, and saturation using request, error, and duration plus utilization, saturation, and errors viewpoints.
3. Distributed tracing for every multi-service request path.
4. Tooling baseline can be Amazon native or third-party equivalents (Datadog, Grafana with Prometheus, OpenTelemetry pipelines).

### Amazon Web Services support
Amazon Web Services provides managed building blocks for all three pillars:
- Logging: Amazon CloudWatch Logs, Amazon OpenSearch Service, and Firehose pipelines.
- Metrics and dashboards: Amazon CloudWatch Metrics and dashboards.
- Tracing: Amazon X-Ray and OpenTelemetry collectors on Amazon Elastic Container Service.
- Alerts and escalation: Amazon CloudWatch Alarms integrated with notification and on-call workflows.
- We will also be using AWS for the Postgresql Aurora and EC2, basically a lot of this app will run on AWS.

### Alert quality standards
- Every alert must have a clear owner and runbook link.
- Every alert must map to a user impact condition.
- Remove noisy alerts quickly.
- Add escalation policy by severity and response time objective.
- Define escalation paths explicitly: primary on-call, secondary on-call, engineering manager, and executive escalation for critical outages.

### Mandatory incident post-mortem culture
MANDATORY: every production incident requires a high quality post-mortem.
- No blame.
- Timeline of what happened.
- Root cause and contributing factors.
- Detection and response gaps.
- Corrective and preventive actions with owners and due dates.
- Follow-up verification that fixes actually reduced risk.

## Infrastructure as code and deployment strategy

### Where Terraform fits
Terraform is the infrastructure as code layer that defines and provisions:
- virtual private cloud networks
- container services
- relational database resources
- cache clusters
- object storage buckets
- identity and access roles
- alarms and dashboards

Benefit: infrastructure changes become versioned, reviewable, repeatable, and auditable.

### Continuous integration and continuous delivery strategy
Keep it simple and strict:
1. Pull request opens.
2. Run lint, types, and tests.
3. Build container images.
4. Deploy to staging.
5. Run end-to-end critical path tests.
6. Manual approval gate for production.
7. Deploy to production with automatic rollback on health failure.

### Application programming interface versioning
- Version all external endpoints from day one.
- Use path versioning such as `/v1/...`.
- Keep backward compatibility for active clients.
- Publish deprecation windows and migration guides before breaking changes.

## Security and compliance surprise prevention
Baseline controls for early enterprise conversations:
- Encryption in transit for all traffic.
- Encryption at rest for relational database and object storage.
- Secrets in managed secrets service, never in source code.
- Dependency vulnerability scanning in pipeline.
- Web application firewall in front of public ingress.
- Audit logs for create, update, delete, permission, and sign-in events.
- Vulnerability disclosure policy published.
- Annual penetration testing plan.

## Compliance and legal readiness checklist
Beyond security controls, prepare these business requirements early:
- Assign one owner for compliance program management and one owner for legal document lifecycle.
- Security control framework roadmap for Service Organization Control Type Two.
- Industry and region obligations depending on customer profile:
  - Health Insurance Portability and Accountability Act
  - General Data Protection Regulation
  - California Consumer Privacy Act
  - International Organization for Standardization Twenty Seven Thousand One
- Privacy policy.
- Terms of service.
- Data processing agreement template.
- Data retention and deletion policy (including customer-initiated deletion workflow).
- Data residency policy with clear region commitments.
- Ability to pin customer data to specific regions when contractually required.
- Subprocessor list and subprocessor notification policy.

## Reliability and latency targets for first release
- Availability target for critical read endpoints: ninety nine point nine percent to start, with path to ninety nine point nine nine percent after hardening.
- Latency target for critical read endpoint percentile ninety five: one hundred milliseconds in-region.
- Latency target for write operations: predictable and observable, with clear service level objectives.

## Expected monthly cost composition
Estimated percentage split of monthly cloud costs for this architecture:
- Relational database: thirty five to fifty five percent.
- Container compute and load balancing: twenty to thirty five percent.
- Logging, monitoring, and tracing: ten to twenty percent.
- Cache: five to fifteen percent.
- Object storage: three to ten percent.
- Data transfer and networking: five to twenty percent.

Cost notes:
- The relational database is commonly the largest line item early.
- Logging can become surprisingly expensive without retention and sampling controls.
- Enforce budgets and resource tags from day one.

## Cost guardrails
- Set monthly budget with alerts.
- Use small baseline compute sizes and scale by metrics.
- Set log retention limits by environment.
- Set object lifecycle rules.
- Delete unused preview resources quickly.
- Tag all resources with team and owner.

## Exit criteria
- Critical end-to-end flows pass in staging and production smoke tests.
- No high severity security findings open.
- Error rates and latency within target bands.
- On-call and rollback instructions tested.
