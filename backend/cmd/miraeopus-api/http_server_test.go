package main

import (
	"net/http"
	"testing"
	"time"
)

func TestConfiguredHTTPServerHasBoundedResponseDeadline(t *testing.T) {
	t.Setenv("HTTP_READ_HEADER_TIMEOUT", "")
	t.Setenv("HTTP_READ_TIMEOUT", "")
	t.Setenv("HTTP_WRITE_TIMEOUT", "")
	t.Setenv("HTTP_IDLE_TIMEOUT", "")
	t.Setenv("HTTP_MAX_HEADER_BYTES", "")

	server := configuredHTTPServer(":0", http.NotFoundHandler())
	if server.ReadHeaderTimeout != 5*time.Second || server.ReadTimeout != 15*time.Second || server.WriteTimeout != 30*time.Second || server.IdleTimeout != 60*time.Second {
		t.Fatalf("HTTP timeouts = header %s read %s write %s idle %s, want 5s/15s/30s/60s", server.ReadHeaderTimeout, server.ReadTimeout, server.WriteTimeout, server.IdleTimeout)
	}
}

func TestConfiguredHTTPServerHonorsWriteTimeoutOverride(t *testing.T) {
	t.Setenv("HTTP_WRITE_TIMEOUT", "7s")
	server := configuredHTTPServer(":0", http.NotFoundHandler())
	if server.WriteTimeout != 7*time.Second {
		t.Fatalf("write timeout = %s, want 7s", server.WriteTimeout)
	}
}
