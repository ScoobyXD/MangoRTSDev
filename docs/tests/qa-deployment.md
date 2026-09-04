# QA Deployment Laws

1. Every successful QA deployment workflow run must deploy the exact approved commit under the `qa` GitHub Environment.
2. The QA deployment workflow must publish the frontend and pass post-deployment smoke tests before it may report success.
3. Database bootstrap remains a separate human-controlled operation and must not be exposed as a successful QA deployment workflow mode.
