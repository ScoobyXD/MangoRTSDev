# QA Deployment Laws

1. Both QA workflow stages must use the existing `qa` GitHub Environment for secrets, variables, and AWS identity.
2. Only the `deploy` stage may create a GitHub deployment record and trigger deployment-based QA.
3. The `bootstrap-images` stage must not create a GitHub deployment record.
