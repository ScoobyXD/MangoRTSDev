package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"miraeopus/backend/internal/domain"
)

func nodeV2TimelineBridgeAvailableTx(ctx context.Context, tx *sql.Tx) (bool, error) {
	var available bool
	err := tx.QueryRowContext(ctx, `select
		to_regclass('public.node_textboxes') is not null
		and to_regclass('public.node_movements') is not null
		and to_regclass('public.node_timeline_items') is not null
		and to_regclass('public.node_verification_requests') is not null
		and to_regclass('public.node_verification_events') is not null
		and to_regclass('public.node_verification_content_pins') is not null
		and to_regclass('public.node_verification_update_pins') is not null
		and to_regclass('public.node_verification_recipients') is not null`).Scan(&available)
	return available, err
}

func insertNodeV2MovementForLegacyTimelineTx(ctx context.Context, tx *sql.Tx, item domain.NodeTimelineEvent) error {
	available, err := nodeV2TimelineBridgeAvailableTx(ctx, tx)
	if err != nil || !available {
		return err
	}
	movementID := newUUIDv7String()
	idempotencyKey := "legacy-transfer:" + item.EventID
	if _, err := tx.ExecContext(ctx, `insert into node_movements(company_id,node_id,movement_id,source_timeline_event_id,from_logic_gate_id,from_logic_gate_name,to_logic_gate_id,to_logic_gate_name,actor_user_id,actor_display_name,idempotency_key,occurred_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7::uuid,$8,$9::uuid,$10,$11,$12) on conflict(company_id,node_id,idempotency_key) do nothing`, item.CompanyID, item.NodeID, movementID, item.EventID, item.FromLogicGateID, item.FromLogicGateName, item.ToLogicGateID, item.ToLogicGateName, item.ActorUserID, item.ActorDisplayName, idempotencyKey, item.CreatedTimestamp); err != nil {
		return err
	}
	var storedMovementID string
	if err := tx.QueryRowContext(ctx, `select movement_id::text from node_movements where company_id=$1::uuid and node_id=$2::uuid and idempotency_key=$3`, item.CompanyID, item.NodeID, idempotencyKey).Scan(&storedMovementID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `insert into node_timeline_items(company_id,node_id,timeline_item_id,item_type,occurred_at,actor_user_id,movement_id,summary_json) select $1::uuid,$2::uuid,$3::uuid,'node_moved',$4,$5::uuid,$6::uuid,jsonb_build_object('from_logic_gate_name',$7::text,'to_logic_gate_name',$8::text,'actor_display_name',$9::text) where not exists(select 1 from node_timeline_items where company_id=$1::uuid and node_id=$2::uuid and movement_id=$6::uuid)`, item.CompanyID, item.NodeID, newUUIDv7String(), item.CreatedTimestamp, item.ActorUserID, storedMovementID, item.FromLogicGateName, item.ToLogicGateName, item.ActorDisplayName)
	return err
}

func insertNodeV2VerificationRequestForLegacyTx(ctx context.Context, tx *sql.Tx, input NodeVerificationRequestInput, item domain.NodeTimelineEvent) error {
	available, err := nodeV2TimelineBridgeAvailableTx(ctx, tx)
	if err != nil || !available {
		return err
	}
	type verificationContentSnapshot struct {
		TextboxID                 string
		ContentRevision           int64
		LatestUpdateSequence      int64
		CollaborationEpoch        string
		CheckpointID              string
		CheckpointThroughSequence int64
	}
	rows, err := tx.QueryContext(ctx, `select
		textbox.textbox_id::text, textbox.content_revision, textbox.latest_update_sequence,
		textbox.collaboration_epoch::text, checkpoint.checkpoint_id::text, checkpoint.through_update_sequence
	from node_textboxes textbox
	join lateral (
		select checkpoint_id, through_update_sequence
		from node_textbox_yjs_checkpoints
		where company_id=textbox.company_id and node_id=textbox.node_id and textbox_id=textbox.textbox_id
		  and collaboration_epoch=textbox.collaboration_epoch
		  and through_update_sequence<=textbox.latest_update_sequence
		order by through_update_sequence desc, checkpoint_id desc
		limit 1
	) checkpoint on true
	where textbox.company_id=$1::uuid and textbox.node_id=$2::uuid and textbox.deleted_timestamp is null
	order by textbox.display_order,textbox.textbox_id
	for share of textbox`, input.CompanyID, input.NodeID)
	if err != nil {
		return err
	}
	snapshots := make([]verificationContentSnapshot, 0)
	manifest := make([]map[string]any, 0)
	for rows.Next() {
		var snapshot verificationContentSnapshot
		if err := rows.Scan(&snapshot.TextboxID, &snapshot.ContentRevision, &snapshot.LatestUpdateSequence, &snapshot.CollaborationEpoch, &snapshot.CheckpointID, &snapshot.CheckpointThroughSequence); err != nil {
			rows.Close()
			return err
		}
		snapshots = append(snapshots, snapshot)
		manifest = append(manifest, map[string]any{
			"textbox_id":                  snapshot.TextboxID,
			"content_revision":            snapshot.ContentRevision,
			"collaboration_epoch":         snapshot.CollaborationEpoch,
			"checkpoint_id":               snapshot.CheckpointID,
			"checkpoint_through_sequence": snapshot.CheckpointThroughSequence,
			"latest_update_sequence":      snapshot.LatestUpdateSequence,
		})
	}
	if err := rows.Close(); err != nil {
		return err
	}
	var activeTextboxCount int
	if err := tx.QueryRowContext(ctx, `select count(*)::integer from node_textboxes where company_id=$1::uuid and node_id=$2::uuid and deleted_timestamp is null`, input.CompanyID, input.NodeID).Scan(&activeTextboxCount); err != nil {
		return err
	}
	if len(snapshots) != activeTextboxCount {
		return errors.New("node v2 verification requires a reconstructable checkpoint for every active textbox")
	}
	manifestJSON, err := json.Marshal(manifest)
	if err != nil {
		return err
	}
	digest := sha256.Sum256(manifestJSON)
	if _, err := tx.ExecContext(ctx, `insert into node_verification_requests(company_id,node_id,verification_request_id,verification_scope,requested_by_user_id,requested_by_display_name,content_manifest,content_manifest_sha256,idempotency_key,requested_timestamp) values($1::uuid,$2::uuid,$3::uuid,'node',$4::uuid,$5,$6::jsonb,$7,$8,$9) on conflict(company_id,node_id,idempotency_key) do nothing`, input.CompanyID, input.NodeID, item.EventID, input.ActorUserID, item.ActorDisplayName, manifestJSON, hex.EncodeToString(digest[:]), input.IdempotencyKey, item.CreatedTimestamp); err != nil {
		return err
	}
	for _, snapshot := range snapshots {
		if _, err := tx.ExecContext(ctx, `insert into node_verification_content_pins(company_id,node_id,verification_request_id,textbox_id,collaboration_epoch,checkpoint_id,checkpoint_through_sequence,head_update_sequence,content_revision) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::uuid,$7,$8,$9) on conflict do nothing`, input.CompanyID, input.NodeID, item.EventID, snapshot.TextboxID, snapshot.CollaborationEpoch, snapshot.CheckpointID, snapshot.CheckpointThroughSequence, snapshot.LatestUpdateSequence, snapshot.ContentRevision); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `insert into node_verification_update_pins(company_id,node_id,verification_request_id,textbox_id,update_sequence) select $1::uuid,$2::uuid,$3::uuid,$4::uuid,update_sequence from node_textbox_yjs_updates where company_id=$1::uuid and node_id=$2::uuid and textbox_id=$4::uuid and collaboration_epoch=$5::uuid and update_sequence>$6 and update_sequence<=$7 on conflict do nothing`, input.CompanyID, input.NodeID, item.EventID, snapshot.TextboxID, snapshot.CollaborationEpoch, snapshot.CheckpointThroughSequence, snapshot.LatestUpdateSequence); err != nil {
			return err
		}
	}
	for _, recipient := range item.VerificationRecipients {
		if _, err := tx.ExecContext(ctx, `insert into node_verification_recipients(company_id,node_id,verification_request_id,user_id,user_display_name,assigned_timestamp) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6) on conflict do nothing`, input.CompanyID, input.NodeID, item.EventID, recipient.UserID, recipient.UserDisplayName, recipient.CreatedTimestamp); err != nil {
			return err
		}
	}
	verificationEventID := newUUIDv7String()
	_, err = tx.ExecContext(ctx, `insert into node_verification_events(company_id,node_id,verification_request_id,verification_event_id,event_type,actor_user_id,actor_display_name,idempotency_key,occurred_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'requested',$5::uuid,$6,'requested',$7) on conflict(company_id,node_id,verification_request_id,idempotency_key) do nothing`, input.CompanyID, input.NodeID, item.EventID, verificationEventID, input.ActorUserID, item.ActorDisplayName, item.CreatedTimestamp)
	return err
}

func insertNodeV2VerificationStampForLegacyTx(ctx context.Context, tx *sql.Tx, input NodeVerificationCompletionInput, item domain.NodeTimelineEvent) error {
	available, err := nodeV2TimelineBridgeAvailableTx(ctx, tx)
	if err != nil || !available {
		return err
	}
	idempotencyKey := "approved:" + input.UserID
	var actorDisplayName string
	if err := tx.QueryRowContext(ctx, `select coalesce(nullif(display_name,''),nullif(email,''),'Unknown user') from users where user_id=$1::uuid`, input.UserID).Scan(&actorDisplayName); errors.Is(err, sql.ErrNoRows) {
		actorDisplayName = "Unknown user"
	} else if err != nil {
		return err
	}
	verificationEventID := newUUIDv7String()
	err = tx.QueryRowContext(ctx, `insert into node_verification_events(company_id,node_id,verification_request_id,verification_event_id,event_type,recipient_user_id,actor_user_id,actor_display_name,idempotency_key,occurred_at) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,'approved',$5::uuid,$5::uuid,$6,$7,now()) on conflict(company_id,node_id,verification_request_id,idempotency_key) do nothing returning verification_event_id::text`, input.CompanyID, input.NodeID, input.EventID, verificationEventID, input.UserID, actorDisplayName, idempotencyKey).Scan(&verificationEventID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `insert into node_timeline_items(company_id,node_id,timeline_item_id,item_type,occurred_at,actor_user_id,verification_event_id,summary_json) values($1::uuid,$2::uuid,$3::uuid,'verification_stamp',now(),$4::uuid,$5::uuid,jsonb_build_object('actor_display_name',$6::text,'legacy_verification_request_id',$7::text))`, input.CompanyID, input.NodeID, newUUIDv7String(), input.UserID, verificationEventID, actorDisplayName, item.EventID); err != nil {
		return err
	}
	var incomplete int
	if err := tx.QueryRowContext(ctx, `select count(*)::integer from node_timeline_verification_recipients where company_id=$1::uuid and node_id=$2::uuid and event_id=$3::uuid and completed_timestamp is null`, input.CompanyID, input.NodeID, input.EventID).Scan(&incomplete); err != nil {
		return err
	}
	if incomplete == 0 {
		_, err = tx.ExecContext(ctx, `update node_verification_requests set current_status='approved',closed_timestamp=coalesce(closed_timestamp,now()) where company_id=$1::uuid and node_id=$2::uuid and verification_request_id=$3::uuid and current_status='requested'`, input.CompanyID, input.NodeID, input.EventID)
		return err
	}
	return nil
}

func memoryNodeV2Summary(value map[string]any) json.RawMessage {
	encoded, _ := json.Marshal(value)
	return encoded
}

func cleanNodeV2Label(value, fallback string) string {
	if value = strings.TrimSpace(value); value != "" {
		return value
	}
	return fallback
}
