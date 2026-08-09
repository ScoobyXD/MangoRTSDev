package realtime

import (
	"context"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
)

type staticCredentialsProvider struct {
	credentials aws.Credentials
}

type fixedAuthProvider struct{}

func (fixedAuthProvider) Credentials(context.Context) (AuthCredentials, error) {
	return AuthCredentials{Username: "test", Password: "test"}, nil
}

func (p staticCredentialsProvider) Retrieve(context.Context) (aws.Credentials, error) {
	return p.credentials, nil
}

func TestLocalBackplaneBroadcastsToEverySubscriber(t *testing.T) {
	backplane := NewLocalBackplane()
	defer backplane.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	received := make(chan string, 2)
	ready := make(chan struct{}, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_ = backplane.Subscribe(ctx, func(payload []byte) { received <- string(payload) }, func() { ready <- struct{}{} })
		}()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-ready:
		case <-time.After(time.Second):
			t.Fatal("local subscriber did not become ready")
		}
	}
	if err := backplane.Publish(ctx, []byte(`{"event_id":"event-1"}`)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		select {
		case got := <-received:
			if got != `{"event_id":"event-1"}` {
				t.Fatalf("payload = %q", got)
			}
		case <-time.After(time.Second):
			t.Fatal("local subscriber did not receive broadcast")
		}
	}
}

func TestIAMAuthProviderSignsServerlessConnectToken(t *testing.T) {
	provider, err := NewIAMAuthProvider("MangoRTS-Dev-Realtime", "mangorts-dev-realtime", "us-west-1", staticCredentialsProvider{credentials: aws.Credentials{
		AccessKeyID: "test-access-key", SecretAccessKey: "test-secret-key", SessionToken: "test-session-token",
	}})
	if err != nil {
		t.Fatal(err)
	}
	provider.now = func() time.Time { return time.Date(2026, 8, 8, 12, 0, 0, 0, time.UTC) }
	credentials, err := provider.Credentials(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if credentials.Username != "mangorts-dev-realtime" {
		t.Fatalf("username = %q", credentials.Username)
	}
	parsed, err := url.Parse("http://" + credentials.Password)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if parsed.Host != "mangorts-dev-realtime" || query.Get("Action") != "connect" || query.Get("User") != credentials.Username || query.Get("ResourceType") != "ServerlessCache" || query.Get("X-Amz-Expires") != "900" {
		t.Fatalf("unexpected signed token shape host=%q action=%q user=%q resource=%q expiry=%q", parsed.Host, query.Get("Action"), query.Get("User"), query.Get("ResourceType"), query.Get("X-Amz-Expires"))
	}
	if !strings.Contains(query.Get("X-Amz-Credential"), "us-west-1/elasticache/aws4_request") {
		t.Fatalf("credential scope does not target ElastiCache in us-west-1")
	}
}

func TestRetryDelayIsBoundedExponentialWithJitter(t *testing.T) {
	if got := retryDelayWithJitter(0, 50_000_000); got != 50*time.Millisecond {
		t.Fatalf("attempt zero delay = %s", got)
	}
	for attempt := 0; attempt < 100; attempt++ {
		got := retryDelayWithJitter(attempt, int64(attempt+1)*987654321)
		if got < 0 || got > maxRetryDelay {
			t.Fatalf("attempt %d delay = %s, want 0..%s", attempt, got, maxRetryDelay)
		}
	}
}

func TestValkeyBackplaneConstructionDoesNotRequireCacheAvailability(t *testing.T) {
	backplane, err := NewValkeyBackplane(ValkeyConfig{
		Endpoint: "127.0.0.1:1", Channel: "mangorts:realtime:v1", Auth: fixedAuthProvider{},
	})
	if err != nil {
		t.Fatalf("lazy construction failed while cache was unavailable: %v", err)
	}
	backplane.Close()
}
