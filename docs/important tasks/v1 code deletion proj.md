# V1 Code Deletion Project

That's a fair concern. LLMs are much better at adding local fixes than doing disciplined subtraction unless the workflow is explicitly built around deletion, measurement, and behavior preservation.

The way to use me safely for this is not "go refactor this huge file." It should be:

## Audit First, No Edits

Identify dead code, duplicate flows, obsolete compatibility paths, unused props/state, over-broad abstractions, and files that are only large because unrelated concerns got packed together.

## Require a Deletion Hypothesis

Every proposed change should say:

- what code can disappear
- why it is redundant or unreachable
- what behavior must remain unchanged
- what test/build/screenshot proves that

## Prefer True Deletion Before Extraction

Splitting a 5,000-line file into six files may improve maintainability, but it does not reduce code. For this goal, extraction only counts if it lets us remove duplication or simplify logic.

## Work Bucket by Bucket

Don't attack 147k lines globally. Start with the biggest concentration:

- `backend/internal/store`
- `backend/internal/http`
- `frontend/src/modules/editor`
- `frontend/src/pages/home`
- `frontend/src/app`

## Track Net LOC

Every cleanup PR should report:

- lines removed
- lines added
- net change
- tests run
- files still over 1,500 lines

For this repo, I'd start with an audit-only pass on the top frontend offenders, especially `HomeParts.tsx`, `NodeWorkspaceSurfaceParts.tsx`, and `HomePage.tsx`. The goal would be a ranked list of deletion/consolidation candidates, not code changes yet. That gives you judgment before letting anyone touch behavior.
