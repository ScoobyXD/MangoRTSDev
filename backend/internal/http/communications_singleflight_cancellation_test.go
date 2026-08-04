package httpapi

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
)

func TestCommunicationsJoinedReadWaiterReturnsOnOwnCancellation(t *testing.T) {
	connection := domain.UserEmailConnection{
		UserID:       "joined-waiter-user",
		Provider:     "google",
		AccountEmail: "joined-waiter@example.com",
		GrantID:      "joined-waiter-grant",
		Scope:        "personal",
	}
	cacheScope := communicationsConnectionCacheScope(connection)

	t.Run("folders", func(t *testing.T) {
		started := make(chan struct{})
		release := make(chan struct{})
		client := &blockingCommunicationsNylasClient{
			fakeNylasClient: &fakeNylasClient{},
			folderStarted:   started,
			folderRelease:   release,
			folderResult:    []NylasFolder{{ID: "inbox", Name: "Inbox"}},
		}
		server := NewServerWithOptions(store.NewMemoryRepo(), ServerOptions{NylasClient: client})
		server.nylasGate = newNylasRequestGate(0)
		t.Cleanup(server.Close)

		assertJoinedCommunicationsReadCancellation(
			t,
			server.commCache,
			"folder",
			communicationsAccountScopedCacheKey(connection.UserID, cacheScope),
			started,
			release,
			client.folderReadCalls,
			func(ctx context.Context) error {
				_, err := server.communicationsFolders(ctx, connection, false)
				return err
			},
		)
	})
}

func assertJoinedCommunicationsReadCancellation(
	t *testing.T,
	cache *communicationsCache,
	generationKind string,
	generationKey string,
	providerStarted <-chan struct{},
	providerRelease chan struct{},
	providerCalls func() int,
	read func(context.Context) error,
) {
	t.Helper()

	var releaseOnce sync.Once
	releaseProvider := func() {
		releaseOnce.Do(func() { close(providerRelease) })
	}
	t.Cleanup(releaseProvider)

	leaderDone := make(chan error, 1)
	go func() {
		leaderDone <- read(context.Background())
	}()

	select {
	case <-providerStarted:
	case <-time.After(5 * time.Second):
		t.Fatal("leader provider read did not start")
	}

	joinedContext, cancelJoined := context.WithCancel(context.Background())
	joinedDone := make(chan error, 1)
	go func() {
		joinedDone <- read(joinedContext)
	}()
	waitForCommunicationsCacheGenerationOwners(t, cache, generationKind, generationKey, 2)

	cancelJoined()
	select {
	case err := <-joinedDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("joined waiter error = %v, want context.Canceled", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("joined waiter did not return after its context was canceled")
	}

	if got := communicationsCacheGenerationOwnerCountForTest(cache, generationKind, generationKey); got != 1 {
		t.Fatalf("generation owners after joined cancellation = %d, want leader only", got)
	}
	if got := providerCalls(); got != 1 {
		t.Fatalf("provider calls after joined cancellation = %d, want one shared call", got)
	}
	select {
	case err := <-leaderDone:
		t.Fatalf("leader returned before provider release: %v", err)
	default:
	}

	releaseProvider()
	select {
	case err := <-leaderDone:
		if err != nil {
			t.Fatalf("leader read: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("leader did not finish after provider release")
	}
	if got := providerCalls(); got != 1 {
		t.Fatalf("provider calls after leader completion = %d, want one", got)
	}
	if got := communicationsCacheGenerationOwnerCountForTest(cache, generationKind, generationKey); got != 0 {
		t.Fatalf("generation owners after completion = %d, want zero", got)
	}
}

func communicationsCacheGenerationOwnerCountForTest(cache *communicationsCache, kind, key string) int {
	cache.mu.RLock()
	defer cache.mu.RUnlock()

	switch kind {
	case "folder":
		return cache.folderGenerations[key].inFlight
	case "page":
		return cache.pageGenerations[key].inFlight
	case "message":
		return cache.messageGenerations[key].inFlight
	default:
		return -1
	}
}
