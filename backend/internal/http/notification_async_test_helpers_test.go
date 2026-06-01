package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
)

func waitForNotificationCountForTest(t *testing.T, list func() []domain.Notification, want int) []domain.Notification {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	var got []domain.Notification
	for {
		got = list()
		if len(got) == want {
			return got
		}
		if time.Now().After(deadline) {
			t.Fatalf("notification count = %d, want %d: %+v", len(got), want, got)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func listNotificationsForRequestForTest(t *testing.T, handler http.Handler, req *http.Request) []domain.Notification {
	t.Helper()
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET notifications status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Notifications []domain.Notification `json:"notifications"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&payload); err != nil {
		t.Fatalf("decode notifications: %v", err)
	}
	return payload.Notifications
}
