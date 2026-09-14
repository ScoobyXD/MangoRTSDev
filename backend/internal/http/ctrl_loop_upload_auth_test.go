package httpapi

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"

	"github.com/xuri/excelize/v2"
)

func TestAuthMiddlewareCtrlLoopWorkbookUpload(t *testing.T) {
	t.Parallel()
	const companyID = "11111111-1111-1111-1111-111111111111"
	const otherCompanyID = "22222222-2222-2222-2222-222222222222"
	const subject = "ctrl-loop-upload-owner"
	key := mustRSAKey(t)
	repo := store.NewMemoryRepo()
	if _, err := repo.UpsertAuthUser(subject, "owner@example.com", ""); err != nil {
		t.Fatal(err)
	}
	repo.EnsureCompany(companyID, "Workbook company")
	if _, err := repo.AddCompanyMembership(subject, companyID, domain.RoleCompanyUser); err != nil {
		t.Fatal(err)
	}
	server := NewServerWithOptions(repo, ServerOptions{AuthValidator: testValidator(t, "kid", key)})
	token := "Bearer " + testJWT(t, key, "kid", subject, "owner@example.com")
	workbook := excelize.NewFile()
	t.Cleanup(func() { _ = workbook.Close() })
	if err := workbook.SetCellStr("Sheet1", "A1", "PO/order number"); err != nil {
		t.Fatal(err)
	}
	buffer, err := workbook.WriteToBuffer()
	if err != nil {
		t.Fatal(err)
	}
	path := "/v1/ctrl-loop/jobs/" + store.NewUUIDv7String()
	for _, tc := range []struct {
		name, method, path, companyID, token string
		status                               int
	}{
		{"member uploads raw Excel", http.MethodPost, path + "/workbook", companyID, token, http.StatusNoContent},
		{"other company denied", http.MethodPost, path + "/workbook", otherCompanyID, token, http.StatusForbidden},
		{"authentication required", http.MethodPost, path + "/workbook", companyID, "", http.StatusUnauthorized},
		{"job edit still requires JSON", http.MethodPatch, path, companyID, token, http.StatusBadRequest},
		{"nested path still requires JSON", http.MethodPost, path + "/other/workbook", companyID, token, http.StatusBadRequest},
	} {
		t.Run(tc.name, func(t *testing.T) {
			called := false
			handler := server.withAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				called = true
				actor, ok := authenticatedActor(r)
				if !ok || actor.CompanyID != companyID {
					t.Fatalf("upload actor company = %q, authenticated = %t", actor.CompanyID, ok)
				}
				data, err := io.ReadAll(r.Body)
				if err != nil || !bytes.Equal(data, buffer.Bytes()) {
					t.Fatalf("upload bytes changed before handler: %v", err)
				}
				w.WriteHeader(http.StatusNoContent)
			}))
			req := httptest.NewRequest(tc.method, tc.path+"?company_id="+tc.companyID, bytes.NewReader(buffer.Bytes()))
			req.Header.Set("Authorization", tc.token)
			req.Header.Set("Content-Type", ctrlLoopMIME)
			req.Header.Set("X-Filename", "orders.xlsx")
			res := httptest.NewRecorder()
			handler.ServeHTTP(res, req)
			if res.Code != tc.status || called != (tc.status == http.StatusNoContent) {
				t.Fatalf("status = %d, handler called = %t, want %d; body = %s", res.Code, called, tc.status, res.Body.String())
			}
			if tc.status == http.StatusForbidden && !strings.Contains(res.Body.String(), "company_access_denied") {
				t.Fatalf("wrong company rejection: %s", res.Body.String())
			}
		})
	}
}
