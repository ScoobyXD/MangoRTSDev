package attachmentcleanup

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"testing"
)

// This repository keeps pending rows across runner instances, like committed
// deleted_timestamp rows surviving an API crash before its local wake.
type drainRepository struct {
	pending     map[string]WorkItem
	lists       int
	loadFailure string
}

func (r *drainRepository) WithItemLock(_ context.Context, _ WorkItem, run func(Repository) ItemResult) ItemResult {
	return run(r)
}

func (r *drainRepository) ListPendingAttachmentDeletionCompanyIDs(context.Context) ([]string, error) {
	set := map[string]bool{}
	for _, item := range r.pending {
		set[item.CompanyID] = true
	}
	companies := make([]string, 0, len(set))
	for company := range set {
		companies = append(companies, company)
	}
	sort.Strings(companies)
	return companies, nil
}

func (r *drainRepository) ListWork(_ context.Context, company, after string, limit int) ([]WorkItem, error) {
	r.lists++
	items := []WorkItem{}
	for _, item := range r.pending {
		if item.CompanyID == company && item.AttachmentID > after {
			items = append(items, item)
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].AttachmentID < items[j].AttachmentID })
	if len(items) > limit {
		items = items[:limit]
	}
	return items, nil
}

func (r *drainRepository) LoadObjects(_ context.Context, item WorkItem) ([]ObjectRef, error) {
	if item.AttachmentID == r.loadFailure {
		return nil, errors.New("temporary metadata failure")
	}
	return item.Objects, nil
}

func (r *drainRepository) Eligible(_ context.Context, item WorkItem) (bool, error) {
	_, ok := r.pending[item.AttachmentID]
	return ok, nil
}

func (*drainRepository) SharedWithRetained(context.Context, WorkItem, ObjectRef) (bool, error) {
	return false, nil
}

func (r *drainRepository) Finalize(_ context.Context, item WorkItem) error {
	delete(r.pending, item.AttachmentID)
	return nil
}

func pendingDrainFixture(count int) *drainRepository {
	r := &drainRepository{pending: map[string]WorkItem{}}
	for i := 1; i <= count; i++ {
		id := fmt.Sprintf("%08d", i)
		r.pending[id] = WorkItem{Kind: WorkOrphanAttachment, CompanyID: "company", AttachmentID: id,
			Objects: []ObjectRef{{Bucket: "bucket", Key: id}}}
	}
	return r
}

func TestDrainPendingPassesFailedFirstItemAndFinishesMultipleBatches(t *testing.T) {
	for _, failure := range []string{"storage", "metadata"} {
		t.Run(failure, func(t *testing.T) {
			repo := pendingDrainFixture(251)
			storage := &fakeStorage{bucket: "bucket", outcomes: map[string][]error{}}
			if failure == "storage" {
				storage.outcomes["00000001"] = []error{errors.New("temporary storage failure")}
			}
			if failure == "metadata" {
				repo.loadFailure = "00000001"
			}
			result, err := DrainPending(context.Background(), repo, storage, DrainOptions{BatchSize: 100, MaxItems: 1000, Apply: true})
			if err != nil || result.Scanned != 251 || result.Capped() || result.FailureCount() != 1 || len(repo.pending) != 1 {
				t.Fatalf("drain: scanned=%d failures=%d capped=%t pending=%d err=%v", result.Scanned, result.FailureCount(), result.Capped(), len(repo.pending), err)
			}
			if repo.lists != 3 {
				t.Fatalf("lists=%d; want three bounded pages", repo.lists)
			}
			repo.loadFailure = ""
			// A fresh run recovers the preserved row without a new deletion marker.
			retried, err := DrainPending(context.Background(), repo, storage, DrainOptions{BatchSize: 100, MaxItems: 1000, Apply: true})
			if err != nil || retried.FinalizedCount() != 1 || len(repo.pending) != 0 {
				t.Fatalf("retry=%+v err=%v", retried, err)
			}
		})
	}
}

func TestDrainPendingCapResumesAcrossCompaniesAndCrashRestarts(t *testing.T) {
	repo := pendingDrainFixture(205)
	last := repo.pending["00000205"]
	last.CompanyID = "later-company"
	repo.pending[last.AttachmentID] = last
	storage := &fakeStorage{bucket: "bucket"}
	options := DrainOptions{BatchSize: 100, MaxItems: 150, Apply: true}
	first, err := DrainPending(context.Background(), repo, storage, options)
	if err != nil || first.Scanned != 150 || first.NextCursor == nil {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	options.After = first.NextCursor
	second, err := DrainPending(context.Background(), repo, storage, options)
	if err != nil || second.Scanned != 55 || second.Capped() || len(repo.pending) != 0 {
		t.Fatalf("second=%+v err=%v", second, err)
	}

	// Simulate commit-before-wake and a crash midway through a bounded pass:
	// neither recovery needs the old process's cursor or channel.
	repo = pendingDrainFixture(205)
	options.After = nil
	_, err = DrainPending(context.Background(), repo, storage, options)
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := DrainPending(context.Background(), repo, storage, options)
	if err != nil || restarted.Scanned != 55 || len(repo.pending) != 0 {
		t.Fatalf("restart=%+v err=%v", restarted, err)
	}
}

type wrongCompanyDrainRepository struct{ *drainRepository }

func (r wrongCompanyDrainRepository) ListWork(ctx context.Context, company, after string, limit int) ([]WorkItem, error) {
	items, err := r.drainRepository.ListWork(ctx, company, after, limit)
	for i := range items {
		items[i].CompanyID = "other-company"
	}
	return items, err
}

func TestDrainPendingRejectsWorkFromAnotherCompanyBeforeStorage(t *testing.T) {
	repo := wrongCompanyDrainRepository{pendingDrainFixture(1)}
	storage := &fakeStorage{bucket: "bucket"}
	_, err := DrainPending(context.Background(), repo, storage, DrainOptions{BatchSize: 100, MaxItems: 1000, Apply: true})
	if err == nil || len(storage.calls) != 0 || len(repo.pending) != 1 {
		t.Fatalf("err=%v calls=%v pending=%d", err, storage.calls, len(repo.pending))
	}
}
