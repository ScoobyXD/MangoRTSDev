# Ctrl Loop landing-page hosting

## Verified on September 14, 2026

The refreshed `mangorts-dev` SSO profile authenticated to AWS account `686458136219`. Jonat explicitly authorized using this account for the public production landing page; a separate production account is not required for this task.

Authenticated `route53domains get-domain-detail` confirmed that `ctrlloop.io` is registered in this account with Amazon Registrar, Inc. The domain is ACTIVE, was registered on September 8, 2026 at 7:30 PM Pacific, expires September 8, 2027, and has auto-renew enabled. The CLI output excluded all registrant contact information.

The public hosted zone is `Z0430279RQF1HYJD8WY7`. It contains only NS and SOA records. Its four nameservers match the registration and public DNS: `ns-1088.awsdns-08.org`, `ns-1816.awsdns-35.co.uk`, `ns-667.awsdns-19.net`, and `ns-106.awsdns-13.com`. Public apex A/AAAA queries returned no address records; `www.ctrlloop.io` returned NXDOMAIN. DNS alone was not used as proof of registration ownership.

There is no existing Ctrl Loop hosting target. The account's only CloudFront distributions serve Mango dev (`E2Q2RQ64A3X87I`) and QA (`E1CMUOXQ1OWYA9`), and its us-east-1 ACM certificates cover only their Mango hostnames. No Ctrl Loop S3 bucket was found. No cloud resources were changed during the audit.

## Concrete proposal awaiting confirmation

AGENTS.md requires explicit confirmation before production Route53 changes and production cloud-resource changes. The user has authorized AWS hosting and this account; confirm the following specific new resources and DNS additions before creating them. This plan introduces usage-billed S3 storage/requests and CloudFront delivery/requests. It reuses the existing hosted zone.

1. Create private S3 bucket `ctrlloop-landing-686458136219` in `us-west-1`, with public access blocked, SSE-S3 encryption, and versioning. Check the proposed name is available before creation.
2. Create a dedicated CloudFront origin access control named `ctrlloop-landing`. Limit the bucket's read policy to the resulting Ctrl Loop distribution.
3. Request a public ACM certificate in `us-east-1` for `ctrlloop.io` and `www.ctrlloop.io`, and add only its DNS-validation CNAME records to zone `Z0430279RQF1HYJD8WY7`.
4. Create a dedicated CloudFront distribution for both hostnames, using the new bucket as its only origin, `index.html` as the default root object, HTTPS redirection, compression, and `PriceClass_100`.
5. Add apex and `www` A/AAAA aliases in the existing zone pointing to the new distribution. Preserve the current NS and SOA records.
6. Publish the reviewed `frontend/dist-landing` files to the new bucket and invalidate only the new distribution.

This static site does not require ECS, ECR, an ALB, a database, or changes to Mango's current distributions. Do not place it under a Mango frontend bucket prefix: normal Mango deployments sync at the bucket root with `--delete`, which would erase that prefix. Never sync this build to either Mango frontend bucket or upload the repository, backend, scripts, schema, local configuration, or secrets.

## Build and publish after approval

Renew SSO when needed and verify the account before any AWS write:

```powershell
aws sso login --profile mangorts-dev
aws sts get-caller-identity --profile mangorts-dev --query Account --output text
```

The account must be `686458136219`. Build from the repository root with `npm --prefix frontend run build:landing`. Review the generated directory and complete the landing-page browser checks before publishing.

Only after the dedicated bucket and distribution above exist and their ownership, aliases, and origin have been verified, run these commands from the repository root. Replace the distribution-ID placeholder with the newly created Ctrl Loop distribution ID. Keep the publication source exactly `frontend/dist-landing`.

```powershell
aws s3 sync frontend/dist-landing s3://ctrlloop-landing-686458136219 --region us-west-1 --profile mangorts-dev --cache-control "public,max-age=300" --dryrun
aws s3 sync frontend/dist-landing s3://ctrlloop-landing-686458136219 --region us-west-1 --profile mangorts-dev --cache-control "public,max-age=300"
aws cloudfront create-invalidation --distribution-id "REPLACE_WITH_CREATED_CTRL_LOOP_DISTRIBUTION_ID" --paths "/*" --profile mangorts-dev --query Invalidation.Id --output text
```

No `--delete` is used. If old-asset cleanup is needed later, first verify the bucket remains dedicated to this site and review the exact deletion list separately. Record the actual distribution ID, certificate ARN, publication revision, and deployment time here after deployment; none has been allocated yet.

## Public verification

Wait for the certificate to be issued, CloudFront deployment and invalidation to complete, and DNS to resolve. Verify `https://ctrlloop.io/` and `https://www.ctrlloop.io/` return the landing page with valid certificates and HTTP redirects to HTTPS. Check desktop and mobile layouts, the sample demo, all navigation and CTAs, missing assets, and browser console errors. Confirm Mango dev and QA still serve their existing apps. A local preview or a successful S3 upload alone is not evidence of a live public deployment.
