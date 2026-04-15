# Two Week Plan

## Objective
Ship a production-lean first release with a browser frontend, a real backend, secure cloud basics, and end-to-end flow coverage for critical user journeys.

## Scope lock
- Keep one frontend service and one backend service for week one delivery speed.
- Keep one relational database cluster.
- Keep one cache cluster only if measured hot path latency requires it.
- Keep one object storage bucket for attachments. (this is not needed right now, only needed after messaging is made)
- Keep one container orchestration platform. (this might not actually be needed at first, we'll see)
- Avoid multi-region, Kubernetes, and advanced streaming in this first release window.

## Microservice-first compromise
To satisfy early service boundaries without heavy overhead:
- Create two backend services from day one:
  1. case-api (authoritative write and read service for case data)
  2. search-api (index and search read service) (okay maybe not this at first, this can be made later)
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
- Confirm data model for case, child case, artifact, and activity.
- Confirm service contracts for case-api and search-api.

### Day 2
- Create environment files and local container compose.
- Add health checks and baseline structured request logging.
- Add database migration folder and first migration.

### Day 3
- Implement relational database repository for case-api.
- Keep in-memory repository for fast local demos and tests.
- Add create case and get case endpoints using relational persistence.

### Day 4
- Add artifact add and artifact delete endpoints with activity logging.
- Add child case creation and parent activity logging.
- Add strict request validation and clear error responses.

### Day 5
- Add authentication middleware and role checks.
- Add tenant scoping key to every business table and query.
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
