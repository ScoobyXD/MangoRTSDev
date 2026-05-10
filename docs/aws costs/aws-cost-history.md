# AWS Cost History

This tracker records AWS billing screenshots over time in append-only CSV files.

## Latest Snapshot

Captured date: 2026-05-10

Billing month: 2026-05

Current month total: USD 43.82

Month change: +22,963%

Forecasted month end: Data unavailable

Savings opportunities: Not enabled

## Service Breakdown

| Billing month | Service | Amount | Share of total |
| --- | --- | ---: | ---: |
| 2026-05 | Registrar | USD 15.00 | 34.23% |
| 2026-05 | Relational Database Service | USD 13.75 | 31.38% |
| 2026-05 | EC2 - Other | USD 5.06 | 11.55% |
| 2026-05 | Elastic Container Service | USD 2.89 | 6.60% |
| 2026-05 | Elastic Load Balancing | USD 2.65 | 6.05% |
| 2026-05 | Others | USD 4.47 | 10.20% |
| 2026-05 | **Total** | **USD 43.82** | **100.00%** |

## Data Files

- [aws-cost-snapshots.csv](aws-cost-snapshots.csv): one row per screenshot or billing observation.
- [aws-cost-services.csv](aws-cost-services.csv): one row per service in each snapshot, joined by `snapshot_id`.

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
| `snapshot_id` | Joins the service row to `aws-cost-snapshots.csv`. |
| `captured_date` | Repeated for filtering without a join. |
| `billing_month` | Repeated for filtering without a join. |
| `currency` | Currency shown by AWS. |
| `service` | AWS service or grouped category. |
| `amount` | Service cost for the billing month. |
| `share_of_total_percent` | Service amount divided by the snapshot total. |
| `source` | Where the service amount came from. |
| `notes` | Freeform audit notes. |

## Update Process

When a new AWS screenshot is provided:

1. Add one row to `aws-cost-snapshots.csv`.
2. Add one row per exact service amount to `aws-cost-services.csv`.
3. Update the Latest Snapshot and Service Breakdown sections above.
4. Do not estimate chart bars without tooltip values. Leave unknown values blank and explain them in `notes`.

