package httpapi

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type sseEventForTest struct {
	ID    string
	Event string
	Data  string
}

func openSSEStreamForTest(t *testing.T, handler http.Handler, target string, configure func(*http.Request)) (*bufio.Reader, context.CancelFunc) {
	t.Helper()
	ts := httptest.NewServer(handler)
	t.Cleanup(ts.Close)

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+target, nil)
	if err != nil {
		cancel()
		t.Fatalf("new SSE request: %v", err)
	}
	if configure != nil {
		configure(req)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		cancel()
		t.Fatalf("open SSE stream: %v", err)
	}
	t.Cleanup(func() {
		resp.Body.Close()
		cancel()
	})
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		cancel()
		t.Fatalf("SSE stream status = %d body=%s", resp.StatusCode, string(body))
	}
	return bufio.NewReader(resp.Body), cancel
}

func readSSEEventForTest(t *testing.T, reader *bufio.Reader) sseEventForTest {
	t.Helper()
	for {
		event, err := readRawSSEEventForTest(reader)
		if err != nil {
			t.Fatalf("read SSE event: %v", err)
		}
		if event.ID != "" || event.Event != "" || event.Data != "" {
			return event
		}
	}
}

func readRawSSEEventForTest(reader *bufio.Reader) (sseEventForTest, error) {
	var event sseEventForTest
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return event, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			return event, nil
		}
		switch {
		case strings.HasPrefix(line, "id:"):
			event.ID = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
		case strings.HasPrefix(line, "event:"):
			event.Event = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			value := strings.TrimPrefix(line, "data:")
			value = strings.TrimPrefix(value, " ")
			if event.Data != "" {
				event.Data += "\n"
			}
			event.Data += value
		}
	}
}
