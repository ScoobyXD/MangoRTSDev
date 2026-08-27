package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
)

type qdRatingScanner interface {
	Scan(dest ...any) error
}

func scanQDRating(row qdRatingScanner) (domain.QDRating, error) {
	var item domain.QDRating
	var quality, cost, delivery, ratedByUserID sql.NullString
	err := row.Scan(
		&item.CompanyID, &item.QDRatingID, &item.LogicGateID,
		&quality, &cost, &delivery, &ratedByUserID, &item.RatedByDisplayName,
		&item.RatedCreatedTimestamp, &item.RatedUpdatedTimestamp,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.QDRating{}, ErrNotFound
	}
	if err != nil {
		return domain.QDRating{}, err
	}
	if quality.Valid {
		item.QualityRating = &quality.String
	}
	if cost.Valid {
		item.CostRating = &cost.String
	}
	if delivery.Valid {
		item.DeliveryRating = &delivery.String
	}
	if ratedByUserID.Valid {
		item.RatedByUserID = &ratedByUserID.String
	}
	return item, nil
}

const qdRatingSelectColumns = `
company_id::text,qd_rating_id::text,logic_gate_id::text,
quality_rating,cost_rating,delivery_rating,rated_by_user_id::text,rated_by_display_name,
rated_created_timestamp,rated_updated_timestamp`

func (r *PostgresRepo) ListLogicGateQDRatings(input QDRatingMonthQuery) ([]domain.QDRating, error) {
	input, err := normalizeQDRatingMonthQuery(input)
	if err != nil {
		return nil, err
	}
	start, end, err := qdRatingMonthBounds(input)
	if err != nil {
		return nil, err
	}
	ctx := context.Background()
	var exists bool
	if err := r.db.QueryRowContext(ctx, `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid)`, input.CompanyID, input.LogicGateID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrNotFound
	}
	rows, err := r.db.QueryContext(ctx, `select `+qdRatingSelectColumns+`
from scorecards
where company_id=$1::uuid and logic_gate_id=$2::uuid
  and (rated_created_timestamp at time zone 'America/Los_Angeles')::date >= $3::date
  and (rated_created_timestamp at time zone 'America/Los_Angeles')::date < $4::date
order by rated_created_timestamp,qd_rating_id`, input.CompanyID, input.LogicGateID, start.Format("2006-01-02"), end.Format("2006-01-02"))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]domain.QDRating, 0)
	for rows.Next() {
		item, scanErr := scanQDRating(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *PostgresRepo) PutLogicGateQDRating(input QDRatingPutInput) (QDRatingMutationResult, error) {
	input, err := normalizeQDRatingPutInput(input)
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	businessDate, err := qdRatingBusinessDate(input.Now)
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	ctx := context.Background()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `select exists(select 1 from logic_gates where company_id=$1::uuid and logic_gate_id=$2::uuid for share)`, input.CompanyID, input.LogicGateID).Scan(&exists); err != nil {
		return QDRatingMutationResult{}, err
	}
	if !exists {
		return QDRatingMutationResult{}, ErrNotFound
	}

	if input.Rating == nil {
		return r.clearPostgresLogicGateQDRating(ctx, tx, input, businessDate)
	}
	return r.setPostgresLogicGateQDRating(ctx, tx, input, businessDate)
}

func (r *PostgresRepo) clearPostgresLogicGateQDRating(ctx context.Context, tx *sql.Tx, input QDRatingPutInput, businessDate string) (QDRatingMutationResult, error) {
	column := "quality_rating"
	if input.Metric == QDRatingMetricCost {
		column = "cost_rating"
	} else if input.Metric == QDRatingMetricDelivery {
		column = "delivery_rating"
	}
	current, err := scanQDRating(tx.QueryRowContext(ctx, `select `+qdRatingSelectColumns+`
from scorecards where company_id=$1::uuid and logic_gate_id=$2::uuid
and (rated_created_timestamp at time zone 'America/Los_Angeles')::date=$3::date
for update`, input.CompanyID, input.LogicGateID, businessDate))
	if errors.Is(err, ErrNotFound) {
		if err := tx.Commit(); err != nil {
			return QDRatingMutationResult{}, err
		}
		return QDRatingMutationResult{}, nil
	}
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	currentValue := current.QualityRating
	if input.Metric == QDRatingMetricCost {
		currentValue = current.CostRating
	} else if input.Metric == QDRatingMetricDelivery {
		currentValue = current.DeliveryRating
	}
	if currentValue == nil {
		if err := tx.Commit(); err != nil {
			return QDRatingMutationResult{}, err
		}
		return QDRatingMutationResult{QDRating: &current}, nil
	}
	result := QDRatingMutationResult{Changed: true}
	hasOtherRating := (input.Metric != QDRatingMetricQuality && current.QualityRating != nil) ||
		(input.Metric != QDRatingMetricCost && current.CostRating != nil) ||
		(input.Metric != QDRatingMetricDelivery && current.DeliveryRating != nil)
	if !hasOtherRating {
		if _, err := tx.ExecContext(ctx, `delete from scorecards where company_id=$1::uuid and qd_rating_id=$2::uuid`, input.CompanyID, current.QDRatingID); err != nil {
			return QDRatingMutationResult{}, err
		}
	} else {
		item, err := scanQDRating(tx.QueryRowContext(ctx, `update scorecards
set `+column+`=null,rated_by_user_id=$3::uuid,rated_by_display_name=$4,rated_updated_timestamp=$5
where company_id=$1::uuid and qd_rating_id=$2::uuid
returning `+qdRatingSelectColumns, input.CompanyID, current.QDRatingID, input.RatedByUserID, input.RatedByDisplayName, input.Now))
		if err != nil {
			return QDRatingMutationResult{}, err
		}
		result.QDRating = &item
	}
	if err := r.enqueueQDRatingRealtimeOutboxTx(ctx, tx, input); err != nil {
		return QDRatingMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return QDRatingMutationResult{}, err
	}
	return result, nil
}

func (r *PostgresRepo) setPostgresLogicGateQDRating(ctx context.Context, tx *sql.Tx, input QDRatingPutInput, businessDate string) (QDRatingMutationResult, error) {
	column := "quality_rating"
	if input.Metric == QDRatingMetricCost {
		column = "cost_rating"
	} else if input.Metric == QDRatingMetricDelivery {
		column = "delivery_rating"
	}
	item, err := scanQDRating(tx.QueryRowContext(ctx, `insert into scorecards(
company_id,qd_rating_id,logic_gate_id,`+column+`,rated_by_user_id,rated_by_display_name,rated_created_timestamp,rated_updated_timestamp)
values($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7,$7)
on conflict (company_id,logic_gate_id,((rated_created_timestamp at time zone 'America/Los_Angeles')::date))
do update set `+column+`=excluded.`+column+`,rated_by_user_id=excluded.rated_by_user_id,
  rated_by_display_name=excluded.rated_by_display_name,rated_updated_timestamp=excluded.rated_updated_timestamp
where scorecards.`+column+` is distinct from excluded.`+column+`
returning `+qdRatingSelectColumns, input.CompanyID, newUUIDv7String(), input.LogicGateID, *input.Rating, input.RatedByUserID, input.RatedByDisplayName, input.Now))
	if errors.Is(err, ErrNotFound) {
		current, currentErr := getPostgresQDRatingForBusinessDate(ctx, tx, input.CompanyID, input.LogicGateID, businessDate)
		if currentErr != nil {
			return QDRatingMutationResult{}, currentErr
		}
		if err := tx.Commit(); err != nil {
			return QDRatingMutationResult{}, err
		}
		return QDRatingMutationResult{QDRating: &current}, nil
	}
	if err != nil {
		return QDRatingMutationResult{}, err
	}
	if err := r.enqueueQDRatingRealtimeOutboxTx(ctx, tx, input); err != nil {
		return QDRatingMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return QDRatingMutationResult{}, err
	}
	return QDRatingMutationResult{QDRating: &item, Changed: true}, nil
}

func getPostgresQDRatingForBusinessDate(ctx context.Context, queryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, companyID, logicGateID, businessDate string) (domain.QDRating, error) {
	return scanQDRating(queryer.QueryRowContext(ctx, `select `+qdRatingSelectColumns+`
from scorecards where company_id=$1::uuid and logic_gate_id=$2::uuid
and (rated_created_timestamp at time zone 'America/Los_Angeles')::date=$3::date`, companyID, logicGateID, businessDate))
}

func (r *PostgresRepo) enqueueQDRatingRealtimeOutboxTx(ctx context.Context, tx *sql.Tx, input QDRatingPutInput) error {
	eventInput := workspaceDomainEventInput(input.CompanyID, QDRatingRealtimeEventType, map[string]any{
		"logic_gate_id": input.LogicGateID,
		"metric":        input.Metric,
	})
	eventInput.ActorUserID = input.RatedByUserID
	if _, err := r.appendDomainEventTx(ctx, tx, eventInput); err != nil {
		return err
	}
	outbox, err := qdRatingRealtimeOutboxInput(input, newUUIDv7String())
	if err != nil {
		return err
	}
	_, err = r.enqueueRealtimeOutboxTx(ctx, tx, outbox)
	return err
}
