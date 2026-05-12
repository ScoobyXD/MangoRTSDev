# AWS Cost History

This tracker records AWS billing screenshots over time in append-only CSV files.

## Latest Snapshot

Captured date: 2026-05-12

Billing month: 2026-05

Current month total: USD 54.41

Month change: +9,793%

Forecasted month end: Data unavailable

Savings opportunities: Not enabled

Notes: AWS chart label displayed May 26, but this snapshot is recorded as 2026-05-12 per the capture date. Service tooltip values sum to USD 54.42 while the widget total shows USD 54.41, likely due to AWS rounding.

## Service Breakdown

| Billing month | Service | Amount | Share of total |
| --- | --- | ---: | ---: |
| 2026-05 | Relational Database Service | USD 16.21 | 29.79% |
| 2026-05 | Registrar | USD 15.00 | 27.57% |
| 2026-05 | EC2 - Other | USD 7.96 | 14.63% |
| 2026-05 | Elastic Container Service | USD 4.60 | 8.45% |
| 2026-05 | Elastic Load Balancing | USD 4.17 | 7.66% |
| 2026-05 | Others | USD 6.48 | 11.91% |
| 2026-05 | **Total** | **USD 54.41** | **100.00%** |

## Data Files

- [aws-cost-snapshots.csv](aws-cost-snapshots.csv): one row per screenshot or billing observation.
- [aws-cost-services.csv](aws-cost-services.csv): one row per checked date, with service costs as columns and `Total` as the rightmost cost column.

## Schema

`aws-cost-snapshots.csv`

| Column | Meaning |
| --- | --- |
| `snapshot_id` | Stable unique ID for a captured AWS billing observation. |
| `captured_date` | Date the screenshot or observation was recorded, in `YYYY-MM-DD` format. |
| `billing_month` | Billing month represented by the AWS widget, in `YYYY-MM` format. |
| `currency` | Currency shown by AWS. |
| `current_month_total` | Current month AWS cost total shown in the widget. |
| `month_change_percent` | Percent change shown beside the current month total. |
| `forecast_month_end_total` | Forecasted month-end total, if AWS provides one. Blank means unavailable. |
| `forecast_status` | Status for the forecast field, such as `available` or `data_unavailable`. |
| `savings_opportunities_status` | Savings opportunity status shown by AWS. |
| `source` | Where the observation came from. |
| `notes` | Freeform audit notes. |

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

1. Add one row to `aws-cost-snapshots.csv`.
2. Add one row to `aws-cost-services.csv`, with exact service tooltip values in the service columns and the widget total in `Total`.
3. Update the Latest Snapshot and Service Breakdown sections above.
4. Do not estimate chart bars without tooltip values. Leave unknown values blank and explain them in `notes`.
