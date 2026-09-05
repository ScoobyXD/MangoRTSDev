package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/store"
)

type attachmentMaintenanceRepository struct {
	store.Repository
	count          int
	finalized      map[string]bool
	discoveryCalls int
	listCalls      int
	listErr        error
	finalizeErr    error
	deadline       time.Time
}

func (r *attachmentMaintenanceRepository) WithItemLock(_ context.Context, _ attachmentcleanup.WorkItem, run func(attachmentcleanup.Repository) attachmentcleanup.ItemResult) attachmentcleanup.ItemResult {
	return run(r)
}

func (r *attachmentMaintenanceRepository) ListPendingAttachmentDeletionCompanyIDs(ctx context.Context) ([]string, error) {
	r.discoveryCalls++
	r.deadline, _ = ctx.Deadline()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if r.listErr != nil {
		return nil, r.listErr
	}
	if r.count == len(r.finalized) {
		return nil, nil
	}
	return []string{"11111111-1111-4111-8111-111111111111"}, nil
}

func (r *attachmentMaintenanceRepository) ListWork(_ context.Context, companyID, after string, limit int) ([]attachmentcleanup.WorkItem, error) {
	r.listCalls++
	work := make([]attachmentcleanup.WorkItem, 0, limit)
	for n := 1; n <= r.count; n++ {
		id := fmt.Sprintf("00000000-0000-4000-8000-%012d", n)
		if id <= after || r.finalized[id] {
			continue
		}
		work = append(work, attachmentcleanup.WorkItem{
			Kind: attachmentcleanup.WorkOrphanAttachment, CompanyID: companyID, AttachmentID: id,
		})
		if len(work) == limit {
			break
		}
	}
	return work, nil
}

func (*attachmentMaintenanceRepository) LoadObjects(_ context.Context, item attachmentcleanup.WorkItem) ([]attachmentcleanup.ObjectRef, error) {
	return []attachmentcleanup.ObjectRef{{Bucket: "attachments", Key: item.AttachmentID}}, nil
}

func (r *attachmentMaintenanceRepository) Eligible(_ context.Context, item attachmentcleanup.WorkItem) (bool, error) {
	return !r.finalized[item.AttachmentID], nil
}

func (*attachmentMaintenanceRepository) SharedWithRetained(context.Context, attachmentcleanup.WorkItem, attachmentcleanup.ObjectRef) (bool, error) {
	return false, nil
}

func (r *attachmentMaintenanceRepository) Finalize(_ context.Context, item attachmentcleanup.WorkItem) error {
	if r.finalizeErr != nil {
		return r.finalizeErr
	}
	if r.finalized == nil {
		r.finalized = map[string]bool{}
	}
	r.finalized[item.AttachmentID] = true
	return nil
}

type attachmentMaintenanceStorage struct {
	bucket string
	err    error
}

func (s attachmentMaintenanceStorage) Bucket() string { return s.bucket }
func (s attachmentMaintenanceStorage) DeleteObject(context.Context, string) error {
	return s.err
}

func TestNormalizeRuntimeRoleIncludesFiniteAttachmentMaintenance(t *testing.T) {
	for _, role := range []string{"api", "email-worker", "attachment-maintenance"} {
		got, err := normalizeRuntimeRole("  " + strings.ToUpper(role) + "  ")
		if err != nil || got != role {
			t.Fatalf("normalizeRuntimeRole(%q) = %q, %v", role, got, err)
		}
	}
	if _, err := normalizeRuntimeRole("attachment-daemon"); err == nil {
		t.Fatal("unknown roles must fail")
	}
}

func TestAttachmentMaintenanceExitsAfterOneEmptyDiscovery(t *testing.T) {
	r := &attachmentMaintenanceRepository{}
	if err := runAttachmentMaintenance(context.Background(), r, attachmentMaintenanceStorage{bucket: "attachments"}); err != nil {
		t.Fatal(err)
	}
	if r.discoveryCalls != 1 || r.listCalls != 0 {
		t.Fatalf("idle discovery=%d lists=%d", r.discoveryCalls, r.listCalls)
	}
	if remaining := time.Until(r.deadline); remaining <= 0 || remaining > 15*time.Minute {
		t.Fatalf("cleanup deadline is not bounded: %s", remaining)
	}
}

func TestAttachmentMaintenanceFinishesMultipleBatchesAndStopsAtTotalCap(t *testing.T) {
	for _, count := range []int{250, 10001} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			r := &attachmentMaintenanceRepository{count: count}
			err := runAttachmentMaintenance(context.Background(), r, attachmentMaintenanceStorage{bucket: "attachments"})
			want := min(count, 10000)
			if len(r.finalized) != want || r.discoveryCalls != 1 {
				t.Fatalf("finalized=%d want=%d discoveries=%d", len(r.finalized), want, r.discoveryCalls)
			}
			if (err != nil) != (count > 10000) {
				t.Fatalf("count=%d err=%v; cap must fail visibly", count, err)
			}
		})
	}
}

func TestAttachmentMaintenanceReportsFailuresAndCanRecoverOnRerun(t *testing.T) {
	for _, stage := range []string{"discovery", "storage", "finalization"} {
		t.Run(stage, func(t *testing.T) {
			r := &attachmentMaintenanceRepository{count: 1}
			s := attachmentMaintenanceStorage{bucket: "attachments"}
			failure := errors.New("temporary failure")
			switch stage {
			case "discovery":
				r.listErr = failure
			case "storage":
				s.err = failure
			case "finalization":
				r.finalizeErr = failure
			}
			if err := runAttachmentMaintenance(context.Background(), r, s); err == nil || len(r.finalized) != 0 {
				t.Fatalf("failed work must remain pending, finalized=%v err=%v", r.finalized, err)
			}
			r.listErr, r.finalizeErr = nil, nil
			s.err = attachmentcleanup.ErrObjectNotFound
			if err := runAttachmentMaintenance(context.Background(), r, s); err != nil || len(r.finalized) != 1 {
				t.Fatalf("rerun must finalize even after bytes were deleted, finalized=%v err=%v", r.finalized, err)
			}
		})
	}
}

func TestAttachmentMaintenanceRejectsMissingDependenciesAndCancellation(t *testing.T) {
	r := &attachmentMaintenanceRepository{}
	if err := runAttachmentMaintenance(context.Background(), r, attachmentMaintenanceStorage{}); err == nil {
		t.Fatal("missing bucket must fail")
	}
	if err := runAttachmentMaintenance(context.Background(), store.NewMemoryRepo(), attachmentMaintenanceStorage{bucket: "attachments"}); err == nil {
		t.Fatal("repository without durable cleanup support must fail")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := runAttachmentMaintenance(ctx, r, attachmentMaintenanceStorage{bucket: "attachments"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation must report failure: %v", err)
	}
}
