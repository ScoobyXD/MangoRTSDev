# Ctrl Loop landing-page hosting

## Account and registration

On September 14, 2026, the `mangorts-dev` SSO profile authenticated to AWS account `686458136219`. Jonat explicitly approved dedicated S3, CloudFront, HTTPS certificate, and DNS setup for this public landing page in that account. S3 storage/requests and CloudFront delivery/requests are usage-billed.

Authenticated `route53domains get-domain-detail` confirmed that `ctrlloop.io` is registered in this account with Amazon Registrar, Inc. The domain is ACTIVE, was registered on September 8, 2026 at 7:30 PM Pacific, expires September 8, 2027, and has auto-renew enabled. The CLI output excluded all registrant contact information.

The existing public hosted zone is `Z0430279RQF1HYJD8WY7`. Its four nameservers match the registration and public DNS: `ns-1088.awsdns-08.org`, `ns-1816.awsdns-35.co.uk`, `ns-667.awsdns-19.net`, and `ns-106.awsdns-13.com`. Before this deployment, the zone contained only NS and SOA records; apex A/AAAA queries returned no addresses and `www.ctrlloop.io` returned NXDOMAIN. Registration ownership was established from the authenticated registrar response, not DNS alone.

## Dedicated hosting

Terraform configuration lives in `infra/aws-ctrl-loop`. It uses the existing state bucket `mangorts-dev-terraform-state-scoobyxd-686458136219` in `us-west-1`, with its own key `ctrl-loop/landing/terraform.tfstate`, encryption, and S3 state locking. Both providers and the backend restrict access to account `686458136219`.

| Resource | Value |
| --- | --- |
| Site hostnames | `ctrlloop.io`, `www.ctrlloop.io` |
| S3 bucket | `ctrlloop-landing-686458136219`, `us-west-1` |
| CloudFront distribution | `E20QAN5SEVBNDT` |
| CloudFront hostname | `dnv9kyy3qntka.cloudfront.net` |
| Origin access control | `E2J89E10WVNCP5`, named `ctrlloop-landing` |
| ACM certificate | `arn:aws:acm:us-east-1:686458136219:certificate/0cc44302-2fa2-46eb-b955-4c7e32f76555` |
| Route 53 hosted zone | `Z0430279RQF1HYJD8WY7` |

The bucket has public access blocked, bucket-owner-enforced ownership, SSE-S3 encryption, and versioning. CloudFront uses its regional S3 REST endpoint with signed origin access; the bucket policy permits object reads only from this distribution. The distribution serves `index.html` at the root, redirects HTTP to HTTPS, allows GET/HEAD, enables compression and IPv6, uses managed caching and security response headers, and selects `PriceClass_100`. The ACM certificate covers both hostnames in `us-east-1`; Terraform manages its DNS-validation CNAMEs and both hostnames' A/AAAA aliases in the existing zone.

The initial plan contained **16 additions, 0 changes, and 0 deletions**. Mango dev (`E2Q2RQ64A3X87I`) and QA (`E1CMUOXQ1OWYA9`) are separate distributions. This site needs no backend, ECS, ECR, ALB, or database resources.

Never publish this build to a Mango frontend bucket or a prefix inside one: Mango deployments sync at their bucket root with `--delete`, which would erase that prefix. Publish only the compiled landing-page files; never upload the repository, backend, scripts, schema, local configuration, or secrets.

## Maintain infrastructure

Run from the repository root in PowerShell with Terraform 1.10 or newer. Use the active SSO session; run `aws sso login --profile mangorts-dev` only if the session has expired. Before any AWS write, select the profile and require the expected account:

```powershell
$env:AWS_PROFILE = "mangorts-dev"
$ctrlLoopAccount = aws sts get-caller-identity --query Account --output text
if ($LASTEXITCODE -ne 0 -or $ctrlLoopAccount -ne "686458136219") { throw "Stop: Ctrl Loop AWS account verification failed." }
terraform "-chdir=infra/aws-ctrl-loop" init
terraform "-chdir=infra/aws-ctrl-loop" validate
terraform "-chdir=infra/aws-ctrl-loop" plan "-out=ctrl-loop.tfplan"
terraform "-chdir=infra/aws-ctrl-loop" show "ctrl-loop.tfplan"
```

Review the saved plan before applying. Future production resource or DNS changes remain subject to the explicit-confirmation requirements in `AGENTS.md`; the initial deployment was specifically approved. Once the concrete changes are authorized:

```powershell
terraform "-chdir=infra/aws-ctrl-loop" apply "ctrl-loop.tfplan"
terraform "-chdir=infra/aws-ctrl-loop" output
```

Do not commit Terraform state or saved plans. Infrastructure is maintained in this isolated Terraform root; there is no automatic GitHub deployment workflow.

## Build and publish

Verify the account as above and confirm the bucket, distribution aliases, and origin still match this runbook. Build from the repository root:

```powershell
npm --prefix frontend run build:landing
```

Stop on build failure. Review `frontend/dist-landing` and check the page in a browser before uploading. It must contain only public HTML, CSS, JavaScript, and assets, without source maps or private Mango application/configuration files. Keep the publication source exactly `frontend/dist-landing`.

First inspect the dry run:

```powershell
aws s3 sync frontend/dist-landing s3://ctrlloop-landing-686458136219 --region us-west-1 --profile mangorts-dev --cache-control "public,max-age=300" --dryrun
```

Then publish and invalidate only the Ctrl Loop distribution:

```powershell
aws s3 sync frontend/dist-landing s3://ctrlloop-landing-686458136219 --region us-west-1 --profile mangorts-dev --cache-control "public,max-age=300"
aws cloudfront create-invalidation --distribution-id E20QAN5SEVBNDT --paths "/*" --profile mangorts-dev --query Invalidation.Id --output text
```

Check each command succeeds before continuing. No `--delete` is used. If old-asset cleanup is needed later, verify the bucket remains dedicated to this site and review the exact deletion list separately. Site updates are manual and independent of Mango releases; they do not require deploying the Mango frontend or backend.

## Deployment record and public verification

Initial publication: September 14, 2026, from landing-page commit `13a15d8036f87472af3c63f251ec3b9ec614915f`. Four reviewed files were uploaded: `index.html` (1,474 bytes), `favicon.svg` (284 bytes), `assets/index-BW80p7QF.css` (29,181 bytes), and `assets/index-D0-OsSZJ.js` (166,099 bytes). Terraform apply completed with 16 additions, 0 changes, and 0 deletions. The certificate is ISSUED, CloudFront deployment completed, and invalidation `I7VI5G1PHPJM4N98G57A361ODQ` completed.

The site is live at `https://ctrlloop.io/` and `https://www.ctrlloop.io/`. Both returned HTTP 200 over verified TLS; HTTP requests returned 301 redirects to their respective HTTPS URLs. The HTML had the correct Ctrl Loop title, and all three referenced local assets returned 200 with the correct MIME types. Responses included `Cache-Control: public,max-age=300` and HSTS with a 31,536,000-second maximum age. Direct anonymous S3 access returned 403. Mango dev and QA continued returning HTTPS 200, with their distribution aliases and origins unchanged.

Live browser checks passed at desktop and mobile widths: the primary CTA opened the sample, all three emails stamped only C2/D3/E2, a previously stamped cell opened its exact source email after changing stages, Escape restored keyboard focus, and mobile navigation and FAQ disclosures worked. There were no app console errors. The final Terraform plan reported no changes. The origin uses OAC directly; an unnecessary empty legacy origin-identity block was removed from the configuration to match AWS's returned state, without another cloud change.

After each publication, wait for CloudFront deployment and invalidation to complete and DNS to resolve. Verify `https://ctrlloop.io/` and `https://www.ctrlloop.io/` return the landing page with valid certificates and HTTP redirects to HTTPS. Check desktop and mobile layouts, the sample demo, all navigation and CTAs, missing assets, and browser console errors. Confirm Mango dev and QA still serve their existing apps. Record the verified publication revision and time here. A local preview or successful S3 upload alone is not evidence of a live public deployment.
