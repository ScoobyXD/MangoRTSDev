package store

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestPostgresAIRunArchive(t *testing.T) {
	for _, source := range []string{"canonical", "migration"} {
		t.Run(source, func(t *testing.T) {
			db := openPostgresProcessMapTestDatabase(t)
			file := filepath.Join("..", "..", "db", "schema.sql")
			if source == "migration" {
				// Only existing typed owner tables are needed by this additive migration.
				if _, err := db.Exec(`
create table public.companies(company_id uuid primary key);
create table public.users(user_id uuid primary key);
create table public.company_memberships(company_id uuid references public.companies on delete cascade,
user_id uuid references public.users on delete cascade,primary key(company_id,user_id));`); err != nil {
					t.Fatal(err)
				}
				file = filepath.Join("..", "..", "db", "migrations", "20260905_ai_runs.sql")
			}
			sqlText, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(string(sqlText)); err != nil {
				t.Fatal(err)
			}
			companyID := "10000000-0000-4000-8000-000000000001"
			otherCompanyID := "10000000-0000-4000-8000-000000000002"
			userID := "20000000-0000-4000-8000-000000000001"
			otherUserID := "20000000-0000-4000-8000-000000000002"
			seedSQL := `insert into public.companies(company_id) values($1),($2);
insert into public.users(user_id) values($3),($4);
insert into public.company_memberships(company_id,user_id) values($1,$3),($2,$3),($1,$4);`
			if source == "canonical" {
				seedSQL = `insert into public.companies(company_id,name) values($1,'AI archive'),($2,'Other archive');
insert into public.users(user_id,cognito_subject,email,display_name) values
($3,'ai-archive-owner','owner@example.com','Owner'),($4,'ai-archive-other','other@example.com','Other');
insert into public.company_memberships(company_id,user_id,role) values($1,$3,'company_admin'),($2,$3,'company_admin'),($1,$4,'company_admin');`
			}
			if _, err := db.Exec(seedSQL, companyID, otherCompanyID, userID, otherUserID); err != nil {
				t.Fatal(err)
			}
			// Compare the exact unordered set, never physical column order.
			columns := map[string]bool{}
			rows, err := db.Query(`select column_name from information_schema.columns where table_schema='public' and table_name='ai_runs'`)
			if err != nil {
				t.Fatal(err)
			}
			for rows.Next() {
				var name string
				if err := rows.Scan(&name); err != nil {
					t.Fatal(err)
				}
				columns[name] = true
			}
			if err := rows.Err(); err != nil {
				t.Fatal(err)
			}
			rows.Close()
			wantColumns := map[string]bool{"company_id": true, "user_id": true, "ai_runs_id": true, "inspection_json": true, "start_time": true, "finish_time": true}
			if !reflect.DeepEqual(columns, wantColumns) {
				t.Fatalf("archive columns = %v", columns)
			}
			repo := NewPostgresRepo(db)
			ctx := context.Background()
			run := aiRunFixture(companyID, userID)
			if err := repo.SaveAIRunContext(ctx, run); err != nil {
				t.Fatal(err)
			}
			duplicate := run
			duplicate.AIRunsID = strings.ToUpper(duplicate.AIRunsID)
			duplicate.InspectionJSON = json.RawMessage(`[]`)
			if err := repo.SaveAIRunContext(ctx, duplicate); err != nil {
				t.Fatal(err)
			}
			var matches bool
			if err := db.QueryRow(`select count(*)=1 and bool_and(start_time=$4 and finish_time=$5 and inspection_json=$6::jsonb)
from public.ai_runs where company_id=$1 and user_id=$2 and ai_runs_id=$3`,
				run.CompanyID, run.UserID, run.AIRunsID, run.StartTime, run.FinishTime, string(run.InspectionJSON)).Scan(&matches); err != nil || !matches {
				t.Fatalf("duplicate changed timestamped inspection: %t, %v", matches, err)
			}
			for _, scoped := range []AIRun{aiRunFixture(otherCompanyID, userID), aiRunFixture(companyID, otherUserID)} {
				if err := repo.SaveAIRunContext(ctx, scoped); err != nil {
					t.Fatal(err)
				}
			}
			for _, missing := range []AIRun{aiRunFixture(newUUIDv7String(), userID), aiRunFixture(companyID, newUUIDv7String())} {
				if err := repo.SaveAIRunContext(ctx, missing); err == nil {
					t.Fatal("archive accepted nonexistent owner endpoint")
				}
			}
			if _, err := db.Exec(`delete from public.company_memberships where company_id=$1 and user_id=$2`, companyID, userID); err != nil {
				t.Fatal(err)
			}
			if count := countPostgresRows(t, db, `select count(*) from public.ai_runs`); count != 3 {
				t.Fatalf("membership removal discarded historical archives: %d", count)
			}
			finishingRun := aiRunFixture(companyID, userID)
			finishingRun.AIRunsID = newUUIDv7String()
			if err := repo.SaveAIRunContext(ctx, finishingRun); err != nil {
				t.Fatalf("admitted Send could not archive after membership removal: %v", err)
			}
			if _, err := db.Exec(`delete from public.users where user_id=$1`, userID); err != nil {
				t.Fatal(err)
			}
			if count := countPostgresRows(t, db, `select count(*) from public.ai_runs`); count != 1 {
				t.Fatalf("user cascade crossed scope: %d", count)
			}
			if _, err := db.Exec(`delete from public.companies where company_id=$1`, companyID); err != nil {
				t.Fatal(err)
			}
			if count := countPostgresRows(t, db, `select count(*) from public.ai_runs`); count != 0 {
				t.Fatalf("company cascade retained archives: %d", count)
			}
		})
	}
}
