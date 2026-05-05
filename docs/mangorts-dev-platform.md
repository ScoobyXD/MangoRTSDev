# MangoRTS Dev Platform V2

MangoRTS dev is a production-shaped AWS environment for development and demos. It is not the official production site.

## Architecture

```text
Browser
  -> Route 53: dev.<domain>
  -> CloudFront + WAF + temporary basic auth
  -> S3 private frontend bucket

Browser/API client
  -> Route 53: api.dev.<domain> or dev.<domain>/v1/*
  -> CloudFront + WAF + temporary basic auth
  -> ALB HTTPS origin
  -> ECS Fargate backend task
  -> existing dev PostgreSQL/Aurora database
```

## Services

- **Route 53** owns DNS records for `dev.<domain>`, `api.dev.<domain>`, and `origin.dev.<domain>`.
- **CloudFront** is the public edge for both frontend and API traffic.
- **S3** stores static Vite build output from `frontend/dist`.
- **WAF** applies AWS managed edge protections.
- **Cognito** owns user login and token issuance.
- **ALB** terminates HTTPS between CloudFront and the regional API origin.
- **ECS Fargate** runs the Go backend container.
- **Secrets Manager** supplies the DB password to ECS without plaintext env vars.
- **Existing database** remains the dev source of truth.

## Terraform Root

Use `infra/aws-dev`. The older `infra/terraform` folder is historical reference only.

The dev stack uses the canonical slug `mangorts`; do not create new AWS resources with the old `mangoos` slug.
