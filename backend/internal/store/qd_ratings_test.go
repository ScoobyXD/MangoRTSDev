package store

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func TestMemoryQDRatingsKeepOneSharedRowPerProcessBusinessDay(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-310000000001"
	firstUserID := "22222222-2222-4222-8222-310000000001"
	secondUserID := "22222222-2222-4222-8222-310000000002"
	gate, err := repo.CreateLogicGate(companyID, "Daily Shipping")
	if err != nil {
		t.Fatal(err)
	}
	firstTime := time.Date(2026, time.August, 25, 7, 30, 0, 0, time.UTC)
	green := "green"
	quality, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricQuality,
		Rating: &green, RatedByUserID: firstUserID, RatedByDisplayName: "Alice", Now: firstTime,
	})
	if err != nil || !quality.Changed || quality.QDRating == nil {
		t.Fatalf("quality result = %+v err=%v", quality, err)
	}
	if quality.QDRating.QualityRating == nil || *quality.QDRating.QualityRating != green || quality.QDRating.CostRating != nil || quality.QDRating.DeliveryRating != nil {
		t.Fatalf("quality row = %+v", quality.QDRating)
	}

	secondTime := firstTime.Add(2 * time.Hour)
	red := "red"
	cost, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricCost,
		Rating: &red, RatedByUserID: secondUserID, RatedByDisplayName: "Bob", Now: secondTime,
	})
	if err != nil || !cost.Changed || cost.QDRating == nil || cost.QDRating.QDRatingID != quality.QDRating.QDRatingID ||
		cost.QDRating.CostRating == nil || *cost.QDRating.CostRating != red {
		t.Fatalf("cost result = %+v err=%v", cost, err)
	}

	thirdTime := secondTime.Add(2 * time.Hour)
	yellow := "yellow"
	delivery, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricDelivery,
		Rating: &yellow, RatedByUserID: secondUserID, RatedByDisplayName: "Bob", Now: thirdTime,
	})
	if err != nil || !delivery.Changed || delivery.QDRating == nil {
		t.Fatalf("delivery result = %+v err=%v", delivery, err)
	}
	if delivery.QDRating.QDRatingID != quality.QDRating.QDRatingID ||
		delivery.QDRating.QualityRating == nil || *delivery.QDRating.QualityRating != green ||
		delivery.QDRating.CostRating == nil || *delivery.QDRating.CostRating != red ||
		delivery.QDRating.DeliveryRating == nil || *delivery.QDRating.DeliveryRating != yellow {
		t.Fatalf("combined row = %+v", delivery.QDRating)
	}
	if !delivery.QDRating.RatedCreatedTimestamp.Equal(firstTime) || !delivery.QDRating.RatedUpdatedTimestamp.Equal(thirdTime) ||
		delivery.QDRating.RatedByUserID == nil || *delivery.QDRating.RatedByUserID != secondUserID || delivery.QDRating.RatedByDisplayName != "Bob" {
		t.Fatalf("combined attribution = %+v", delivery.QDRating)
	}

	items, err := repo.ListLogicGateQDRatings(QDRatingMonthQuery{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Year: 2026, Month: time.August,
	})
	if err != nil || len(items) != 1 {
		t.Fatalf("August ratings = %+v err=%v", items, err)
	}
	noChange, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricDelivery,
		Rating: &yellow, RatedByUserID: firstUserID, RatedByDisplayName: "Alice", Now: thirdTime.Add(time.Hour),
	})
	if err != nil || noChange.Changed || noChange.QDRating == nil || noChange.QDRating.RatedByDisplayName != "Bob" {
		t.Fatalf("same-value result = %+v err=%v", noChange, err)
	}

	if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricQuality,
		RatedByUserID: firstUserID, RatedByDisplayName: "Alice", Now: thirdTime.Add(2 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricDelivery,
		RatedByUserID: firstUserID, RatedByDisplayName: "Alice", Now: thirdTime.Add(3 * time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	cleared, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricCost,
		RatedByUserID: firstUserID, RatedByDisplayName: "Alice", Now: thirdTime.Add(4 * time.Hour),
	})
	if err != nil || !cleared.Changed || cleared.QDRating != nil {
		t.Fatalf("clear result = %+v err=%v", cleared, err)
	}
	items, err = repo.ListLogicGateQDRatings(QDRatingMonthQuery{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Year: 2026, Month: time.August,
	})
	if err != nil || len(items) != 0 {
		t.Fatalf("ratings after clear = %+v err=%v", items, err)
	}
}

func TestMemoryQDRatingWriteProducesAuthorizedTargetedRealtimeEvent(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-310000000002"
	userID := "22222222-2222-4222-8222-310000000003"
	gate, err := repo.CreateLogicGate(companyID, "Realtime Process")
	if err != nil {
		t.Fatal(err)
	}
	red := "red"
	if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricQuality,
		Rating: &red, RatedByUserID: userID, RatedByDisplayName: "Rater", Now: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ClaimRealtimeOutbox(context.Background(), RealtimeOutboxClaimQuery{Limit: 20, LeaseDuration: time.Minute})
	if err != nil {
		t.Fatal(err)
	}
	wantScope := "editor-json:logic_gate:" + gate.LogicGateID + ":qd-ratings"
	found := false
	for _, item := range items {
		if item.EventType != QDRatingRealtimeEventType {
			continue
		}
		found = true
		if item.Scope != wantScope || item.ResourceType != EntityTypeLogicGate || item.ResourceID != gate.LogicGateID || item.Permission != EntityPermissionEdit {
			t.Fatalf("QDC realtime event = %+v", item)
		}
	}
	if !found {
		t.Fatalf("QDC realtime event missing from %+v", items)
	}
}

func TestMemoryQDRatingsRecycleAndRestoreWithLogicGate(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "11111111-1111-4111-8111-310000000003"
	userID := "22222222-2222-4222-8222-310000000004"
	gate, err := repo.CreateLogicGate(companyID, "Restorable Process")
	if err != nil {
		t.Fatal(err)
	}
	green := "green"
	now := time.Date(2026, time.August, 25, 18, 0, 0, 0, time.UTC)
	if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: companyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricQuality,
		Rating: &green, RatedByUserID: userID, RatedByDisplayName: "Restorer", Now: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(companyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeLogicGate, ID: gate.LogicGateID}}, userID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ListLogicGateQDRatings(QDRatingMonthQuery{CompanyID: companyID, LogicGateID: gate.LogicGateID, Year: 2026, Month: time.August}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("list after recycle err=%v, want ErrNotFound", err)
	}
	recycled, err := repo.ListRecycleBinItems(companyID, userID)
	if err != nil || len(recycled) == 0 {
		t.Fatalf("recycle items=%+v err=%v", recycled, err)
	}
	var itemID string
	for _, item := range recycled {
		if item.ObjectKind == EntityTypeLogicGate && item.ObjectID == gate.LogicGateID {
			itemID = item.RecycleBinItemID
			break
		}
	}
	if itemID == "" {
		t.Fatalf("logic gate recycle item missing: %+v", recycled)
	}
	if _, err := repo.RestoreRecycleBinItems(companyID, userID, []string{itemID}); err != nil {
		t.Fatal(err)
	}
	restored, err := repo.ListLogicGateQDRatings(QDRatingMonthQuery{CompanyID: companyID, LogicGateID: gate.LogicGateID, Year: 2026, Month: time.August})
	if err != nil || len(restored) != 1 || restored[0].QualityRating == nil || *restored[0].QualityRating != green {
		t.Fatalf("restored ratings=%+v err=%v", restored, err)
	}
}

func TestMemoryQDRatingsKeepDisplaySnapshotAfterRaterDeletion(t *testing.T) {
	repo := NewMemoryRepo()
	company, err := repo.CreateCompany("Memory QDC rater deletion")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("memory-qd-admin", "memory-qd-admin@example.com", "Memory Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, "company_admin"); err != nil {
		t.Fatal(err)
	}
	rater, err := repo.UpsertAuthUser("memory-qd-rater", "memory-qd-rater@example.com", "Former Rater")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(rater.CognitoSubject, company.CompanyID, "company_user"); err != nil {
		t.Fatal(err)
	}
	activeGate, err := repo.CreateLogicGate(company.CompanyID, "Active rated Process")
	if err != nil {
		t.Fatal(err)
	}
	recycledGate, err := repo.CreateLogicGate(company.CompanyID, "Recycled rated Process")
	if err != nil {
		t.Fatal(err)
	}
	green := "green"
	now := time.Date(2026, time.August, 25, 18, 0, 0, 0, time.UTC)
	for _, gateID := range []string{activeGate.LogicGateID, recycledGate.LogicGateID} {
		if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
			CompanyID: company.CompanyID, LogicGateID: gateID, Metric: QDRatingMetricQuality,
			Rating: &green, RatedByUserID: rater.UserID, RatedByDisplayName: rater.DisplayName, Now: now,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeLogicGate, ID: recycledGate.LogicGateID}}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyUser(company.CompanyID, rater.UserID, true); err != nil {
		t.Fatal(err)
	}
	active, err := repo.ListLogicGateQDRatings(QDRatingMonthQuery{CompanyID: company.CompanyID, LogicGateID: activeGate.LogicGateID, Year: 2026, Month: time.August})
	if err != nil || len(active) != 1 || active[0].RatedByUserID != nil || active[0].RatedByDisplayName != rater.DisplayName {
		t.Fatalf("active historical attribution=%+v err=%v", active, err)
	}
	recycled, err := repo.ListRecycleBinItems(company.CompanyID, admin.UserID)
	if err != nil || len(recycled) != 1 {
		t.Fatalf("recycle items=%+v err=%v", recycled, err)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, admin.UserID, []string{recycled[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	restored, err := repo.ListLogicGateQDRatings(QDRatingMonthQuery{CompanyID: company.CompanyID, LogicGateID: recycledGate.LogicGateID, Year: 2026, Month: time.August})
	if err != nil || len(restored) != 1 || restored[0].RatedByUserID != nil || restored[0].RatedByDisplayName != rater.DisplayName {
		t.Fatalf("restored historical attribution=%+v err=%v", restored, err)
	}
}

func TestQDRatingSchemaKeepsThePrototypeColumnsAndBusinessDayUniqueness(t *testing.T) {
	migration, err := os.ReadFile("../../db/migrations/20260825_qd_ratings.sql")
	if err != nil {
		t.Fatal(err)
	}
	schema, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatal(err)
	}
	costMigration, err := os.ReadFile("../../db/migrations/20260825_z_qd_cost_rating.sql")
	if err != nil {
		t.Fatal(err)
	}
	renameMigration, err := os.ReadFile("../../db/migrations/20260826_z_scorecards.sql")
	if err != nil {
		t.Fatal(err)
	}
	prototypeText := strings.ToLower(string(migration))
	for _, required := range []string{"qd_ratings", "quality_rating is not null", "delivery_rating is not null"} {
		if !strings.Contains(prototypeText, required) {
			t.Fatalf("prototype migration missing %q", required)
		}
	}
	costText := strings.ToLower(string(costMigration))
	for _, required := range []string{"qd_ratings", "cost_rating", "qd_ratings_cost_rating_chk", "quality_rating is not null", "cost_rating is not null", "delivery_rating is not null"} {
		if !strings.Contains(costText, required) {
			t.Fatalf("cost migration missing %q", required)
		}
	}
	for name, raw := range map[string][]byte{"schema": schema} {
		text := strings.ToLower(string(raw))
		for _, required := range []string{
			"create table", "scorecards", "qd_rating_id", "logic_gate_id", "quality_rating", "delivery_rating",
			"rated_by_user_id", "rated_by_display_name", "rated_created_timestamp", "rated_updated_timestamp",
			"america/los_angeles", "on delete cascade", "scorecards_has_rating_chk",
			"users(user_id)", "on delete set null",
		} {
			if !strings.Contains(text, required) {
				t.Fatalf("%s missing %q", name, required)
			}
		}
	}
	renameText := strings.ToLower(string(renameMigration))
	for _, required := range []string{
		"alter table qd_ratings rename to scorecards",
		"rename constraint qd_ratings_pkey to scorecards_pkey",
		"alter index uq_qd_ratings_logic_gate_business_day rename to uq_scorecards_logic_gate_business_day",
		"restore_payload ? 'qd_ratings'",
		"jsonb_build_object('scorecards'",
	} {
		if !strings.Contains(renameText, required) {
			t.Fatalf("score card rename migration missing %q", required)
		}
	}
	migrationText := strings.ToLower(string(migration))
	for _, forbidden := range []string{"rating_date", "rating_timestamp", " type text", "rated_by_user_id uuid not null"} {
		if strings.Contains(migrationText, forbidden) {
			t.Fatalf("migration contains forbidden prototype column %q", forbidden)
		}
	}
}

func TestPostgresQDRatingRepositoryLifecycle(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("QDC repository test")
	if err != nil {
		t.Fatal(err)
	}
	user, err := repo.UpsertAuthUser("qd-postgres-rater", "qd-postgres-rater@example.com", "Postgres Rater")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(user.CognitoSubject, company.CompanyID, "company_admin"); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Postgres Rated Process")
	if err != nil {
		t.Fatal(err)
	}
	created := time.Date(2026, time.August, 25, 7, 30, 0, 0, time.UTC)
	green, red, yellow := "green", "red", "yellow"
	first, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricQuality,
		Rating: &green, RatedByUserID: user.UserID, RatedByDisplayName: user.DisplayName, Now: created,
	})
	if err != nil || !first.Changed || first.QDRating == nil {
		t.Fatalf("first Postgres rating=%+v err=%v", first, err)
	}
	cost, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricCost,
		Rating: &red, RatedByUserID: user.UserID, RatedByDisplayName: user.DisplayName, Now: created.Add(time.Hour),
	})
	if err != nil || !cost.Changed || cost.QDRating == nil || cost.QDRating.QDRatingID != first.QDRating.QDRatingID ||
		cost.QDRating.CostRating == nil || *cost.QDRating.CostRating != red {
		t.Fatalf("cost Postgres rating=%+v err=%v", cost, err)
	}
	second, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricDelivery,
		Rating: &yellow, RatedByUserID: user.UserID, RatedByDisplayName: user.DisplayName, Now: created.Add(2 * time.Hour),
	})
	if err != nil || !second.Changed || second.QDRating == nil || second.QDRating.QDRatingID != first.QDRating.QDRatingID {
		t.Fatalf("second Postgres rating=%+v err=%v", second, err)
	}
	var rowCount int
	if err := db.QueryRow(`select count(*) from scorecards where company_id=$1::uuid and logic_gate_id=$2::uuid`, company.CompanyID, gate.LogicGateID).Scan(&rowCount); err != nil || rowCount != 1 {
		t.Fatalf("Postgres QDC row count=%d err=%v", rowCount, err)
	}
	if _, err := db.Exec(`insert into scorecards(company_id,qd_rating_id,logic_gate_id,rated_by_display_name,rated_created_timestamp,rated_updated_timestamp)
values($1::uuid,$2::uuid,$3::uuid,'Invalid empty row',$4,$4)`, company.CompanyID, newUUIDv7String(), gate.LogicGateID, created.AddDate(0, 0, 1)); err == nil {
		t.Fatal("Postgres accepted a QDC row with all ratings null")
	}
	if _, err := db.Exec(`update scorecards set cost_rating='blue' where company_id=$1::uuid and logic_gate_id=$2::uuid`, company.CompanyID, gate.LogicGateID); err == nil {
		t.Fatal("Postgres accepted an invalid Cost rating")
	}
	if _, err := db.Exec(`delete from users where user_id=$1::uuid`, user.UserID); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListLogicGateQDRatings(QDRatingMonthQuery{
		CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Year: 2026, Month: time.August,
	})
	if err != nil || len(items) != 1 || items[0].RatedByUserID != nil || items[0].RatedByDisplayName != user.DisplayName {
		t.Fatalf("historical Postgres attribution=%+v err=%v", items, err)
	}
}

func TestPostgresQDRatingRestoreSurvivesDeletedRater(t *testing.T) {
	db, repo := openPostgresProcessMapIntegration(t)
	company, err := repo.CreateCompany("QDC recycled rater deletion")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := repo.UpsertAuthUser("qd-recycle-admin", "qd-recycle-admin@example.com", "Recycle Admin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(admin.CognitoSubject, company.CompanyID, "company_admin"); err != nil {
		t.Fatal(err)
	}
	rater, err := repo.UpsertAuthUser("qd-recycle-rater", "qd-recycle-rater@example.com", "Deleted Rater")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(rater.CognitoSubject, company.CompanyID, "company_user"); err != nil {
		t.Fatal(err)
	}
	gate, err := repo.CreateLogicGate(company.CompanyID, "Recycled Postgres rated Process")
	if err != nil {
		t.Fatal(err)
	}
	red := "red"
	if _, err := repo.PutLogicGateQDRating(QDRatingPutInput{
		CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Metric: QDRatingMetricDelivery,
		Rating: &red, RatedByUserID: rater.UserID, RatedByDisplayName: rater.DisplayName,
		Now: time.Date(2026, time.August, 25, 18, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCompanyExplorerTargets(company.CompanyID, []CompanyExplorerDeleteTargetInput{{Kind: EntityTypeLogicGate, ID: gate.LogicGateID}}, admin.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`delete from users where user_id=$1::uuid`, rater.UserID); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListRecycleBinItems(company.CompanyID, admin.UserID)
	if err != nil || len(items) != 1 {
		t.Fatalf("recycle items=%+v err=%v", items, err)
	}
	if _, err := repo.RestoreRecycleBinItems(company.CompanyID, admin.UserID, []string{items[0].RecycleBinItemID}); err != nil {
		t.Fatal(err)
	}
	restored, err := repo.ListLogicGateQDRatings(QDRatingMonthQuery{CompanyID: company.CompanyID, LogicGateID: gate.LogicGateID, Year: 2026, Month: time.August})
	if err != nil || len(restored) != 1 || restored[0].RatedByUserID != nil || restored[0].RatedByDisplayName != rater.DisplayName {
		t.Fatalf("restored Postgres attribution=%+v err=%v", restored, err)
	}
}
