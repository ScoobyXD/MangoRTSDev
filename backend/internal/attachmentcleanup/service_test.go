package attachmentcleanup

import (
	"context"
	"errors"
	"testing"
)

type fakeRepository struct {
	work          []WorkItem
	eligible      map[string]bool
	shared        map[string]bool
	finalized     []string
	finalizeError error
}

func (f *fakeRepository) ListWork(context.Context, string, int) ([]WorkItem, error) {
	return append([]WorkItem(nil), f.work...), nil
}

func (f *fakeRepository) Eligible(_ context.Context, item WorkItem) (bool, error) {
	return f.eligible[item.AttachmentID], nil
}

func (f *fakeRepository) SharedWithRetained(
	_ context.Context,
	item WorkItem,
	object ObjectRef,
) (bool, error) {
	return f.shared[item.AttachmentID+"\x1f"+object.Bucket+"\x1f"+object.Key], nil
}

func (f *fakeRepository) Finalize(_ context.Context, item WorkItem) error {
	if f.finalizeError != nil {
		return f.finalizeError
	}
	f.finalized = append(f.finalized, item.AttachmentID)
	return nil
}

type fakeStorage struct {
	bucket   string
	outcomes map[string][]error
	calls    []string
}

func (f *fakeStorage) Bucket() string {
	return f.bucket
}

func (f *fakeStorage) DeleteObject(_ context.Context, key string) error {
	f.calls = append(f.calls, key)
	queue := f.outcomes[key]
	if len(queue) == 0 {
		return nil
	}
	err := queue[0]
	f.outcomes[key] = queue[1:]
	return err
}

func orphanWork(objects ...ObjectRef) WorkItem {
	return WorkItem{
		Kind:         WorkOrphanAttachment,
		CompanyID:    "11111111-1111-1111-1111-111111111111",
		AttachmentID: "22222222-2222-2222-2222-222222222222",
		Objects:      objects,
	}
}

func runApply(t *testing.T, repository *fakeRepository, storage *fakeStorage) Result {
	t.Helper()
	result, err := (Service{Repository: repository, Storage: storage}).Run(
		context.Background(),
		Options{
			CompanyID: "11111111-1111-1111-1111-111111111111",
			Limit:     100,
			Apply:     true,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCleanupZeroOwnerSuccessDeletesObjectsThenFinalizes(t *testing.T) {
	item := orphanWork(
		ObjectRef{Bucket: "bucket", Key: "original"},
		ObjectRef{Bucket: "bucket", Key: "preview"},
	)
	repository := &fakeRepository{
		work:     []WorkItem{item},
		eligible: map[string]bool{item.AttachmentID: true},
		shared:   map[string]bool{},
	}
	storage := &fakeStorage{bucket: "bucket", outcomes: map[string][]error{}}
	result := runApply(t, repository, storage)
	if result.FailureCount() != 0 || result.FinalizedCount() != 1 {
		t.Fatalf("result=%+v", result)
	}
	if len(storage.calls) != 2 || len(repository.finalized) != 1 {
		t.Fatalf("delete calls=%v finalized=%v", storage.calls, repository.finalized)
	}
}

func TestCleanupAlreadyMissingObjectCountsAsDeleted(t *testing.T) {
	item := orphanWork(ObjectRef{Bucket: "bucket", Key: "missing"})
	repository := &fakeRepository{
		work:     []WorkItem{item},
		eligible: map[string]bool{item.AttachmentID: true},
		shared:   map[string]bool{},
	}
	storage := &fakeStorage{
		bucket:   "bucket",
		outcomes: map[string][]error{"missing": {ErrObjectNotFound}},
	}
	result := runApply(t, repository, storage)
	if result.Items[0].AlreadyMissing != 1 || !result.Items[0].Finalized {
		t.Fatalf("item=%+v", result.Items[0])
	}
}

func TestCleanupSharedKeyIsProtectedAndDatabaseReferenceIsRemoved(t *testing.T) {
	item := orphanWork(ObjectRef{Bucket: "bucket", Key: "shared"})
	repository := &fakeRepository{
		work:     []WorkItem{item},
		eligible: map[string]bool{item.AttachmentID: true},
		shared: map[string]bool{
			item.AttachmentID + "\x1fbucket\x1fshared": true,
		},
	}
	storage := &fakeStorage{bucket: "bucket", outcomes: map[string][]error{}}
	result := runApply(t, repository, storage)
	if result.Items[0].ProtectedObjects != 1 || !result.Items[0].Finalized {
		t.Fatalf("item=%+v", result.Items[0])
	}
	if len(storage.calls) != 0 {
		t.Fatalf("shared object was deleted: %v", storage.calls)
	}
}

func TestCleanupPartialFailureLeavesDatabaseForRetry(t *testing.T) {
	item := orphanWork(
		ObjectRef{Bucket: "bucket", Key: "one"},
		ObjectRef{Bucket: "bucket", Key: "two"},
	)
	repository := &fakeRepository{
		work:     []WorkItem{item},
		eligible: map[string]bool{item.AttachmentID: true},
		shared:   map[string]bool{},
	}
	transient := errors.New("temporary S3 failure")
	storage := &fakeStorage{
		bucket: "bucket",
		outcomes: map[string][]error{
			"one": {nil, ErrObjectNotFound},
			"two": {transient, nil},
		},
	}
	first, err := (Service{Repository: repository, Storage: storage}).Run(
		context.Background(),
		Options{CompanyID: item.CompanyID, Limit: 100, Apply: true},
	)
	if err != nil {
		t.Fatal(err)
	}
	if first.FailureCount() != 1 || len(repository.finalized) != 0 {
		t.Fatalf("first=%+v finalized=%v", first, repository.finalized)
	}
	second := runApply(t, repository, storage)
	if second.FailureCount() != 0 || second.FinalizedCount() != 1 {
		t.Fatalf("second=%+v", second)
	}
}

func TestCleanupFinalizeFailureLeavesPendingRowForRetry(t *testing.T) {
	item := orphanWork(ObjectRef{Bucket: "bucket", Key: "original"})
	repository := &fakeRepository{
		work:          []WorkItem{item},
		eligible:      map[string]bool{item.AttachmentID: true},
		shared:        map[string]bool{},
		finalizeError: errors.New("temporary Postgres failure"),
	}
	storage := &fakeStorage{bucket: "bucket", outcomes: map[string][]error{}}
	first := runApply(t, repository, storage)
	if first.FailureCount() != 1 || first.Items[0].FailureStage != "finalize_database" ||
		first.Items[0].Finalized || len(repository.finalized) != 0 {
		t.Fatalf("first=%+v finalized=%v", first, repository.finalized)
	}

	repository.finalizeError = nil
	second := runApply(t, repository, storage)
	if second.FailureCount() != 0 || second.FinalizedCount() != 1 ||
		len(storage.calls) != 2 {
		t.Fatalf("second=%+v delete calls=%v", second, storage.calls)
	}
}

func TestCleanupMultipleSurvivingRelationshipsSkipsDeletion(t *testing.T) {
	item := orphanWork(ObjectRef{Bucket: "bucket", Key: "original"})
	repository := &fakeRepository{
		work:     []WorkItem{item},
		eligible: map[string]bool{item.AttachmentID: false},
		shared:   map[string]bool{},
	}
	storage := &fakeStorage{bucket: "bucket", outcomes: map[string][]error{}}
	result := runApply(t, repository, storage)
	if !result.Items[0].Skipped || len(storage.calls) != 0 ||
		len(repository.finalized) != 0 {
		t.Fatalf("item=%+v calls=%v finalized=%v",
			result.Items[0], storage.calls, repository.finalized)
	}
}

func TestCleanupDryRunDoesNotDeleteOrFinalize(t *testing.T) {
	item := orphanWork(ObjectRef{Bucket: "bucket", Key: "original"})
	repository := &fakeRepository{
		work:     []WorkItem{item},
		eligible: map[string]bool{item.AttachmentID: true},
		shared:   map[string]bool{},
	}
	storage := &fakeStorage{bucket: "bucket", outcomes: map[string][]error{}}
	result, err := (Service{Repository: repository, Storage: storage}).Run(
		context.Background(),
		Options{CompanyID: item.CompanyID, Limit: 100},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(storage.calls) != 0 || len(repository.finalized) != 0 ||
		result.Items[0].Finalized {
		t.Fatalf("dry run mutated state: %+v", result)
	}
}

func TestCleanupRejectsWorkFromAnotherCompany(t *testing.T) {
	item := orphanWork(ObjectRef{Bucket: "bucket", Key: "original"})
	item.CompanyID = "33333333-3333-3333-3333-333333333333"
	repository := &fakeRepository{
		work:     []WorkItem{item},
		eligible: map[string]bool{item.AttachmentID: true},
		shared:   map[string]bool{},
	}
	storage := &fakeStorage{bucket: "bucket", outcomes: map[string][]error{}}
	result := runApply(t, repository, storage)
	if result.FailureCount() != 1 || len(storage.calls) != 0 || len(repository.finalized) != 0 {
		t.Fatalf("result=%+v calls=%v finalized=%v", result, storage.calls, repository.finalized)
	}
}
