# AWS Cost History

This tracker records AWS billing screenshots over time in an append-only service cost CSV.

## Latest Snapshot

Captured date: 2026-05-17

Billing month: 2026-05

Current month total: USD 81.52

Month change: +6,989%

Forecasted month end: USD 162.41

Savings opportunities: Not enabled

Notes: AWS chart tooltip displayed May 26, but this snapshot is recorded as 2026-05-17 per the user-provided capture date. The tooltip service values sum exactly to the widget total.

## Service Breakdown

| Billing month | Service | Amount | Share of total |
| --- | --- | ---: | ---: |
| 2026-05 | Relational Database Service | USD 25.29 | 31.02% |
| 2026-05 | Registrar | USD 15.00 | 18.40% |
| 2026-05 | EC2 - Other | USD 13.73 | 16.84% |
| 2026-05 | Elastic Container Service | USD 8.02 | 9.84% |
| 2026-05 | Elastic Load Balancing | USD 7.22 | 8.86% |
| 2026-05 | Others | USD 12.26 | 15.04% |
| 2026-05 | **Total** | **USD 81.52** | **100.00%** |

## Data Files

- [aws-cost-services.csv](aws-cost-services.csv): one row per checked date, with service costs as columns and `Total` as the rightmost cost column.
- [aws-cost-audit-2026-05-17.md](aws-cost-audit-2026-05-17.md): investigation notes for the May 17 cost spike.

## Schema

`aws-cost-services.csv`

| Column | Meaning |
| --- | --- |
| `captured_date` | Date the screenshot or observation was recorded, in `YYYY-MM-DD` format. |
| `billing_month` | Billing month represented by the AWS widget, in `YYYY-MM` format. |
| `currency` | Currency shown by AWS. |
| Service cost columns | One column per AWS service or grouped category, using the exact tooltip amount shown by AWS. |
| `Total` | Current month total shown by the AWS widget. This may differ from the sum of rounded service columns by a cent. |

## Update Process

When a new AWS screenshot is provided:

1. Add one row to `aws-cost-services.csv`, with exact service tooltip values in the service columns and the widget total in `Total`.
2. Update the Latest Snapshot and Service Breakdown sections above.
3. Do not estimate chart bars without tooltip values. Leave unknown values blank and explain them in `notes`.
