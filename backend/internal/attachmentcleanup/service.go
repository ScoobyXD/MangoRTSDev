package attachmentcleanup

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
)

var (
	ErrObjectNotFound = errors.New("attachment object already missing")
	ErrStillOwned     = errors.New("attachment still has a surviving relationship")
)

type WorkKind string

const (
	WorkOrphanAttachment WorkKind = "orphan_attachment"
)

type ObjectRef struct {
	Bucket string
	Key    string
}

type WorkItem struct {
	Kind         WorkKind
	CompanyID    string
	AttachmentID string
	Objects      []ObjectRef
}

type Repository interface {
	WithItemLock(ctx context.Context, item WorkItem, run func(Repository) ItemResult) ItemResult
	ListWork(ctx context.Context, companyID, afterAttachmentID string, limit int) ([]WorkItem, error)
	LoadObjects(ctx context.Context, item WorkItem) ([]ObjectRef, error)
	Eligible(ctx context.Context, item WorkItem) (bool, error)
	SharedWithRetained(ctx context.Context, item WorkItem, object ObjectRef) (bool, error)
	Finalize(ctx context.Context, item WorkItem) error
}

type PendingRepository interface {
	Repository
	ListPendingAttachmentDeletionCompanyIDs(ctx context.Context) ([]string, error)
}

type Storage interface {
	Bucket() string
	DeleteObject(ctx context.Context, key string) error
}

type Options struct {
	CompanyID string
	Limit     int
	Apply     bool
}

type ItemResult struct {
	Kind             WorkKind
	CompanyID        string
	AttachmentID     string
	FailureStage     string
	ObjectCount      int
	DeletedObjects   int
	AlreadyMissing   int
	ProtectedObjects int
	Finalized        bool
	Skipped          bool
	Err              error
}

type Result struct {
	Items []ItemResult
}

func (r Result) FailureCount() int {
	total := 0
	for _, item := range r.Items {
		if item.Err != nil {
			total++
		}
	}
	return total
}

func (r Result) FinalizedCount() int {
	total := 0
	for _, item := range r.Items {
		if item.Finalized {
			total++
		}
	}
	return total
}

type Service struct {
	Repository Repository
	Storage    Storage
}

func (s Service) Run(ctx context.Context, options Options) (Result, error) {
	companyID := strings.TrimSpace(options.CompanyID)
	if ctx == nil || s.Repository == nil || s.Storage == nil || companyID == "" {
		return Result{}, errors.New("cleanup requires context, repository, storage, and company scope")
	}
	if options.Limit <= 0 {
		return Result{}, errors.New("cleanup limit must be positive")
	}
	work, err := s.Repository.ListWork(ctx, companyID, "", options.Limit)
	if err != nil {
		return Result{}, fmt.Errorf("list cleanup work: %w", err)
	}
	result := Result{Items: make([]ItemResult, 0, len(work))}
	for _, item := range work {
		if strings.TrimSpace(item.CompanyID) != companyID {
			result.Items = append(result.Items, ItemResult{
				Kind:         item.Kind,
				CompanyID:    strings.TrimSpace(item.CompanyID),
				AttachmentID: strings.TrimSpace(item.AttachmentID),
				FailureStage: "company_scope",
				Err:          errors.New("repository returned cleanup work for another company"),
			})
			continue
		}
		result.Items = append(result.Items, s.RunItem(ctx, item, options.Apply))
	}
	return result, nil
}

func (s Service) RunItem(ctx context.Context, item WorkItem, apply bool) ItemResult {
	item.CompanyID = strings.TrimSpace(item.CompanyID)
	item.AttachmentID = strings.TrimSpace(item.AttachmentID)
	current := ItemResult{Kind: item.Kind, CompanyID: item.CompanyID, AttachmentID: item.AttachmentID}
	if ctx == nil || s.Repository == nil || s.Storage == nil || item.CompanyID == "" ||
		item.AttachmentID == "" || item.Kind != WorkOrphanAttachment {
		current.FailureStage = "validate_work_item"
		current.Err = errors.New("invalid cleanup work item")
		return current
	}
	return s.Repository.WithItemLock(ctx, item, func(repository Repository) ItemResult {
		return (Service{Repository: repository, Storage: s.Storage}).runLockedItem(ctx, item, apply)
	})
}

func (s Service) runLockedItem(ctx context.Context, item WorkItem, apply bool) ItemResult {
	current := ItemResult{Kind: item.Kind, CompanyID: item.CompanyID, AttachmentID: item.AttachmentID}
	eligible, eligibleErr := s.Repository.Eligible(ctx, item)
	if eligibleErr != nil {
		current.FailureStage = "recheck_eligibility"
		current.Err = fmt.Errorf("recheck cleanup eligibility: %w", eligibleErr)
		return current
	}
	if !eligible {
		current.Skipped = true
		return current
	}

	objects, err := s.Repository.LoadObjects(ctx, item)
	if err != nil {
		current.FailureStage = "load_storage_objects"
		current.Err = fmt.Errorf("load attachment storage objects: %w", err)
		return current
	}
	objects = deduplicateObjects(objects)
	current.ObjectCount = len(objects)
	readyToFinalize := true
	for _, object := range objects {
		if strings.TrimSpace(object.Bucket) == "" || strings.TrimSpace(object.Key) == "" {
			current.FailureStage = "validate_object_reference"
			current.Err = errors.New("database cleanup object is missing bucket or key")
			readyToFinalize = false
			break
		}
		shared, sharedErr := s.Repository.SharedWithRetained(ctx, item, object)
		if sharedErr != nil {
			current.FailureStage = "check_retained_references"
			current.Err = fmt.Errorf("check retained object references: %w", sharedErr)
			readyToFinalize = false
			break
		}
		if shared {
			current.ProtectedObjects++
			continue
		}
		if !apply {
			continue
		}
		if strings.TrimSpace(s.Storage.Bucket()) != strings.TrimSpace(object.Bucket) {
			current.FailureStage = "validate_storage_bucket"
			current.Err = errors.New("database object bucket does not match configured attachment bucket")
			readyToFinalize = false
			break
		}
		// A batch may wait behind slow storage calls. Check the current owner and
		// recycle state immediately before each destructive request as well.
		eligible, err := s.Repository.Eligible(ctx, item)
		if err != nil {
			current.FailureStage = "recheck_eligibility"
			current.Err = fmt.Errorf("recheck cleanup eligibility: %w", err)
			return current
		}
		if !eligible {
			current.Skipped = true
			return current
		}
		deleteErr := s.Storage.DeleteObject(ctx, object.Key)
		switch {
		case deleteErr == nil:
			current.DeletedObjects++
		case errors.Is(deleteErr, ErrObjectNotFound):
			current.AlreadyMissing++
		default:
			current.FailureStage = "delete_storage_object"
			current.Err = fmt.Errorf("delete attachment object: %w", deleteErr)
			readyToFinalize = false
		}
		if !readyToFinalize {
			break
		}
	}
	if apply && readyToFinalize {
		if finalizeErr := s.Repository.Finalize(ctx, item); errors.Is(finalizeErr, ErrStillOwned) {
			current.Skipped = true
		} else if finalizeErr != nil {
			current.FailureStage = "finalize_database"
			current.Err = fmt.Errorf("finalize database cleanup: %w", finalizeErr)
		} else {
			current.Finalized = true
		}
	}
	return current
}
func deduplicateObjects(objects []ObjectRef) []ObjectRef {
	byIdentity := make(map[string]ObjectRef, len(objects))
	for _, object := range objects {
		object.Bucket = strings.TrimSpace(object.Bucket)
		object.Key = strings.TrimSpace(object.Key)
		identity := object.Bucket + "\x1f" + object.Key
		byIdentity[identity] = object
	}
	identities := make([]string, 0, len(byIdentity))
	for identity := range byIdentity {
		identities = append(identities, identity)
	}
	sort.Strings(identities)
	out := make([]ObjectRef, 0, len(identities))
	for _, identity := range identities {
		out = append(out, byIdentity[identity])
	}
	return out
}
