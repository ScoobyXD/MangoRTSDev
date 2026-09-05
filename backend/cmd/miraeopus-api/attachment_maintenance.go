package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"miraeopus/backend/internal/attachmentcleanup"
	"miraeopus/backend/internal/store"
)

func normalizeRuntimeRole(raw string) (string, error) {
	role := strings.ToLower(strings.TrimSpace(raw))
	switch role {
	case "api", "email-worker", "attachment-maintenance":
		return role, nil
	default:
		return "", errors.New("MANGORTS_RUNTIME_ROLE must be api, email-worker, or attachment-maintenance")
	}
}

func runAttachmentMaintenance(ctx context.Context, repo store.Repository, rawStorage any) error {
	repository, ok := repo.(attachmentcleanup.PendingRepository)
	if !ok {
		return errors.New("attachment maintenance requires PostgreSQL cleanup repository support")
	}
	storage, ok := rawStorage.(attachmentcleanup.Storage)
	if !ok || strings.TrimSpace(storage.Bucket()) == "" {
		return errors.New("attachment maintenance requires deletion-capable S3 storage")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	result, err := attachmentcleanup.DrainPending(ctx, repository, storage, attachmentcleanup.DrainOptions{
		BatchSize: 100,
		MaxItems:  10000,
		Apply:     true,
	})
	for _, item := range result.Items {
		if item.Err != nil {
			log.Printf("attachment_maintenance status=item_failed company_id=%s attachment_id=%s stage=%s", item.CompanyID, item.AttachmentID, item.FailureStage)
		}
	}
	log.Printf("attachment_maintenance status=finished examined=%d finalized=%d failures=%d capped=%t", result.Scanned, result.FinalizedCount(), result.FailureCount(), result.Capped())
	if err != nil {
		return fmt.Errorf("attachment maintenance drain failed: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("attachment maintenance interrupted: %w", err)
	}
	if result.FailureCount() > 0 || result.Capped() {
		return errors.New("attachment maintenance left pending work; inspect failures or item cap and rerun")
	}
	return nil
}
