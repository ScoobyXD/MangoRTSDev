# QA Deployment Laws

1. A successful verified application deployment must use the `qa` GitHub Environment.
2. A bootstrap-image run must use the `qa-bootstrap` GitHub Environment and must never report a deployment to `qa`.
3. The `qa` and `qa-bootstrap` GitHub Environments must each provide the variables and secrets required by their selected workflow stage.
