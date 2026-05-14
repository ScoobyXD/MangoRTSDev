# AWS Cost History

This tracker records AWS billing screenshots over time in an append-only service cost CSV.

## Latest Snapshot

Captured date: 2026-05-13

Billing month: 2026-05

Current month total: USD 62.26

Month change: +9,193%

Forecasted month end: USD 156.62

Savings opportunities: Not enabled

Notes: AWS chart tooltip displayed May 26, but this snapshot is recorded as 2026-05-13 per the user-provided capture date. The tooltip service values sum exactly to the widget total.

## Service Breakdown

| Billing month | Service | Amount | Share of total |
| --- | --- | ---: | ---: |
| 2026-05 | Relational Database Service | USD 19.01 | 30.53% |
| 2026-05 | Registrar | USD 15.00 | 24.09% |
| 2026-05 | EC2 - Other | USD 9.69 | 15.56% |
| 2026-05 | Elastic Container Service | USD 5.63 | 9.04% |
| 2026-05 | Elastic Load Balancing | USD 5.10 | 8.19% |
| 2026-05 | Others | USD 7.83 | 12.58% |
| 2026-05 | **Total** | **USD 62.26** | **100.00%** |

## Data Files

- [aws-cost-services.csv](aws-cost-services.csv): one row per checked date, with service costs as columns and `Total` as the rightmost cost column.

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
