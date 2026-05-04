# Dependencies And Docker Plan

This records the dependency/Docker decisions made so far. The full Docker implementation is pending.

## Decision

Create one canonical dependency manifest first, then derive Dockerfiles and compose setup from it.

Preferred future repo-root file:

```text
dependencies.yaml
```

## Current Known Dependencies

Host/development tools:

```text
git
docker
node
npm
go
rg
powershell
```

Runtime services:

```text
postgres
```

Frontend:

```text
frontend/package.json
frontend/package-lock.json
```

Backend:

```text
backend/go.mod
backend/go.sum
```

Verification:

```text
node scripts/run_all_tests.mjs
powershell -ExecutionPolicy Bypass -File .\scripts\fast_verify.ps1 -Root .
powershell -ExecutionPolicy Bypass -File .\scripts\check_conflict_markers.ps1 -Root .
```

## Ripgrep

`rg` is required for conflict-marker scans and fast verification. On Windows:

```powershell
winget install BurntSushi.ripgrep.MSVC
```

`scripts/agent_preflight.ps1` should fail early if `git` or `rg` is missing.

## Planned Docker Artifacts

```text
Dockerfile.backend
Dockerfile.frontend
Dockerfile.agent
docker-compose.yml
```

Intended services:

```text
postgres
backend
frontend
agent
```

## Principle

The dependency manifest should be human-readable and agent-readable. Dockerfiles should implement it, not replace it as the only dependency list.

