package attachmentcleanup

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

type Cursor struct {
	CompanyID    string
	AttachmentID string
}

type DrainOptions struct {
	BatchSize int
	MaxItems  int
	Apply     bool
	After     *Cursor
}

type DrainResult struct {
	Result
	Scanned    int
	NextCursor *Cursor
}

func (r DrainResult) Capped() bool {
	return r.NextCursor != nil
}

// DrainPending scans pending deletion work in stable company and attachment order.
// Failed items do not stop the cursor, so one broken low-ID item cannot hide later work.
func DrainPending(
	ctx context.Context,
	repository PendingRepository,
	storage Storage,
	options DrainOptions,
) (DrainResult, error) {
	if ctx == nil || repository == nil || storage == nil {
		return DrainResult{}, errors.New("cleanup drain requires context, repository, and storage")
	}
	if options.BatchSize <= 0 || options.MaxItems <= 0 {
		return DrainResult{}, errors.New("cleanup drain batch size and item limit must be positive")
	}

	companyIDs, err := repository.ListPendingAttachmentDeletionCompanyIDs(ctx)
	if err != nil {
		return DrainResult{}, fmt.Errorf("list pending attachment deletion companies: %w", err)
	}
	result := DrainResult{Result: Result{Items: make([]ItemResult, 0)}}
	startCompanyID, startAttachmentID := "", ""
	if options.After != nil {
		startCompanyID = strings.TrimSpace(options.After.CompanyID)
		startAttachmentID = strings.TrimSpace(options.After.AttachmentID)
	}
	service := Service{Repository: repository, Storage: storage}

	for companyIndex, companyID := range companyIDs {
		if companyID == "" || (startCompanyID != "" && companyID < startCompanyID) {
			continue
		}
		afterAttachmentID := ""
		if companyID == startCompanyID {
			afterAttachmentID = startAttachmentID
		}

		for result.Scanned < options.MaxItems {
			remaining := options.MaxItems - result.Scanned
			pageSize := options.BatchSize
			if remaining < pageSize {
				pageSize = remaining
			}
			work, listErr := repository.ListWork(ctx, companyID, afterAttachmentID, pageSize+1)
			if listErr != nil {
				return resultWithResumeCursor(result, companyID, afterAttachmentID),
					fmt.Errorf("list attachment deletion work for company %s: %w", companyID, listErr)
			}
			if len(work) == 0 {
				break
			}

			processCount := len(work)
			if processCount > pageSize {
				processCount = pageSize
			}
			for _, item := range work[:processCount] {
				if err := ctx.Err(); err != nil {
					return resultWithResumeCursor(result, companyID, afterAttachmentID), err
				}
				itemAttachmentID := strings.TrimSpace(item.AttachmentID)
				if itemAttachmentID == "" || itemAttachmentID <= afterAttachmentID {
					return resultWithResumeCursor(result, companyID, afterAttachmentID),
						errors.New("cleanup repository returned an invalid or unordered attachment cursor")
				}
				if strings.TrimSpace(item.CompanyID) != companyID {
					return resultWithResumeCursor(result, companyID, afterAttachmentID),
						errors.New("cleanup repository returned work for another company")
				}
				result.Items = append(result.Items, service.RunItem(ctx, item, options.Apply))
				result.Scanned++
				afterAttachmentID = itemAttachmentID
			}

			if result.Scanned == options.MaxItems {
				if len(work) > processCount || companyIndex+1 < len(companyIDs) {
					result.NextCursor = &Cursor{CompanyID: companyID, AttachmentID: afterAttachmentID}
				}
				return result, nil
			}
			if len(work) <= processCount {
				break
			}
		}
	}
	return result, nil
}

func resultWithResumeCursor(result DrainResult, companyID, attachmentID string) DrainResult {
	if strings.TrimSpace(attachmentID) != "" {
		result.NextCursor = &Cursor{
			CompanyID:    strings.TrimSpace(companyID),
			AttachmentID: strings.TrimSpace(attachmentID),
		}
	}
	return result
}
