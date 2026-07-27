package httpapi

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestPostgresRealtimeNodeV2HTTPTimelineCursorWithTiedTimestamps(t *testing.T) {
	if os.Getenv("MANGORTS_REALTIME_POSTGRES_TEST") != "1" || os.Getenv("DB_NAME") != "mangorts_realtime_test" {
		t.Skip("disposable realtime PostgreSQL integration database not configured")
	}
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", os.Getenv("DB_HOST"), os.Getenv("DB_PORT"), os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD"), os.Getenv("DB_NAME"), os.Getenv("DB_SSLMODE"))
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	repo := store.NewPostgresRepo(db)
	company, err := repo.CreateCompany("Node V2 HTTP PostgreSQL")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.Exec("delete from companies where company_id=$1::uuid", company.CompanyID) })
	suffix := fmt.Sprint(time.Now().UnixNano())
	subject := "node-v2-http-postgres-" + suffix
	actor, err := repo.UpsertAuthUser(subject, subject+"@example.test", "Node V2 HTTP PostgreSQL")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.AddCompanyMembership(subject, company.CompanyID, domain.RoleCompanyAdmin); err != nil {
		t.Fatal(err)
	}
	node, err := repo.CreateNode(company.CompanyID, "Tied timeline")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`insert into workspace_editor_formats(company_id,editor_format,migration_state,expected_document_count,converted_document_count,validated_timestamp,cutover_timestamp) values($1::uuid,'tiptap_json','ready',0,0,now(),now())`, company.CompanyID); err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 65; index++ {
		if _, err := repo.CreateNodeV2TextBox(store.NodeV2CreateTextBoxInput{CompanyID: company.CompanyID, NodeID: node.NodeID, ActorUserID: actor.UserID, IdempotencyKey: fmt.Sprintf("http-tied-%03d", index)}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`update node_timeline_items set occurred_at='2026-02-02T02:02:02Z' where company_id=$1::uuid and node_id=$2::uuid`, company.CompanyID, node.NodeID); err != nil {
		t.Fatal(err)
	}

	handler := NewServer(repo).Routes()
	request := func(cursor *store.NodeV2Cursor) store.NodeV2TimelinePage {
		path := fmt.Sprintf("/v1/nodes/%s/v2/timeline?company_id=%s&limit=11", node.NodeID, company.CompanyID)
		if cursor != nil {
			encoded, _ := json.Marshal(cursor)
			path += "&cursor=" + base64.RawURLEncoding.EncodeToString(encoded)
		}
		req := httptest.NewRequest(http.MethodGet, path, bytes.NewReader(nil))
		req = requestWithActorForTest(req, actor, company.CompanyID)
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, req)
		if recorder.Code != http.StatusOK {
			t.Fatalf("timeline status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var page store.NodeV2TimelinePage
		if err := json.Unmarshal(recorder.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		return page
	}

	seen := map[string]bool{}
	var cursor *store.NodeV2Cursor
	for {
		page := request(cursor)
		for _, item := range page.Items {
			if seen[item.TimelineItemID] {
				t.Fatalf("duplicate timeline item %s", item.TimelineItemID)
			}
			seen[item.TimelineItemID] = true
		}
		if page.NextCursor == nil {
			break
		}
		if page.NextCursor.Version != 1 || page.NextCursor.Kind != "node_v2_timeline" || page.NextCursor.ID == "" {
			t.Fatalf("invalid stable cursor %+v", page.NextCursor)
		}
		cursor = page.NextCursor
	}
	if len(seen) != 65 {
		t.Fatalf("HTTP timeline items=%d want=65", len(seen))
	}
}
