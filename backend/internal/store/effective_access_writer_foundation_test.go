package store

import (
	"context"
	"database/sql"
	"errors"
	"miraeopus/backend/internal/domain"
	"strings"
	"testing"
	"time"
)

func TestMemoryEffectiveAccessWriterSourceReplacementDeletesStaleAndWritesNew(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333401"
	userID := "33333333-3333-4333-8333-333333333402"
	nodeID := "33333333-3333-4333-8333-333333333403"
	nextNodeID := "33333333-3333-4333-8333-333333333404"
	sourceType := "direct_user_grant"
	sourceID := "node:" + nodeID + ":user:" + userID
	otherSourceID := "node:" + nodeID + ":group:33333333-3333-4333-8333-333333333405"
	now := time.Now().UTC()

	repo.mu.Lock()
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionEdit, sourceType, sourceID))
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionView, "direct_group_grant", otherSourceID))
	err := repo.replaceEffectiveFactsForSourceLocked(companyID, sourceType, sourceID, []domain.EffectiveResourceAccess{
		effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nextNodeID, EntityPermissionView, sourceType, sourceID),
		effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nextNodeID, EntityPermissionAdmin, sourceType, sourceID),
	})
	repo.mu.Unlock()
	if err != nil {
		t.Fatalf("replaceEffectiveFactsForSourceLocked: %v", err)
	}

	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nodeID, sourceType, sourceID)]; ok {
		t.Fatalf("stale source fact for original node was not deleted")
	}
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nodeID, "direct_group_grant", otherSourceID)]; !ok {
		t.Fatalf("other source fact for same user/resource was deleted")
	}
	next := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nextNodeID, sourceType, sourceID)]
	if next.AccessLevel != EntityPermissionAdmin {
		t.Fatalf("replacement access level = %q, want strongest duplicate fact admin", next.AccessLevel)
	}
}

func TestMemoryEffectiveAccessWriterSourceDeletionPreservesOtherSources(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333411"
	userID := "33333333-3333-4333-8333-333333333412"
	nodeID := "33333333-3333-4333-8333-333333333413"
	sourceID := "node:" + nodeID + ":assignee:" + userID
	otherSourceID := "node:" + nodeID + ":user:" + userID
	now := time.Now().UTC()

	repo.mu.Lock()
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionEdit, effectiveAccessSourceNodeAssignee, sourceID))
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionView, "direct_user_grant", otherSourceID))
	err := repo.deleteEffectiveFactsForSourceLocked(companyID, effectiveAccessSourceNodeAssignee, sourceID)
	repo.mu.Unlock()
	if err != nil {
		t.Fatalf("deleteEffectiveFactsForSourceLocked: %v", err)
	}

	assertEffectiveAccess(t, repo, companyID, userID, EntityTypeNode, nodeID, EntityPermissionView, true)
	assertEffectiveAccess(t, repo, companyID, userID, EntityTypeNode, nodeID, EntityPermissionEdit, false)
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nodeID, effectiveAccessSourceNodeAssignee, sourceID)]; ok {
		t.Fatalf("deleted source fact is still present")
	}
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nodeID, "direct_user_grant", otherSourceID)]; !ok {
		t.Fatalf("other source fact was deleted")
	}
}

func TestMemoryEffectiveAccessWriterResourceSourceReplacementIsResourceScoped(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333421"
	userID := "33333333-3333-4333-8333-333333333422"
	nodeID := "33333333-3333-4333-8333-333333333423"
	otherNodeID := "33333333-3333-4333-8333-333333333424"
	sourceID := "node:" + nodeID + ":assignee:" + userID
	nextSourceID := "node:" + nodeID + ":assignee:33333333-3333-4333-8333-333333333425"
	otherResourceSourceID := "node:" + otherNodeID + ":assignee:" + userID
	otherFamilySourceID := "node:" + nodeID + ":user:" + userID
	now := time.Now().UTC()

	repo.mu.Lock()
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionEdit, effectiveAccessSourceNodeAssignee, sourceID))
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, otherNodeID, EntityPermissionEdit, effectiveAccessSourceNodeAssignee, otherResourceSourceID))
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionView, "direct_user_grant", otherFamilySourceID))
	err := repo.replaceEffectiveFactsForResourceSourceLocked(companyID, EntityTypeNode, nodeID, effectiveAccessSourceNodeAssignee, []domain.EffectiveResourceAccess{
		effectiveAccessWriterFact(companyID, "33333333-3333-4333-8333-333333333425", EntityTypeNode, nodeID, EntityPermissionEdit, effectiveAccessSourceNodeAssignee, nextSourceID),
	})
	repo.mu.Unlock()
	if err != nil {
		t.Fatalf("replaceEffectiveFactsForResourceSourceLocked: %v", err)
	}

	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nodeID, effectiveAccessSourceNodeAssignee, sourceID)]; ok {
		t.Fatalf("stale resource/source-family fact was not deleted")
	}
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, otherNodeID, effectiveAccessSourceNodeAssignee, otherResourceSourceID)]; !ok {
		t.Fatalf("same source family on a different resource was deleted")
	}
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nodeID, "direct_user_grant", otherFamilySourceID)]; !ok {
		t.Fatalf("different source family on same resource was deleted")
	}
}

func TestMemoryEffectiveAccessWriterInvalidFactsFailWithoutMutation(t *testing.T) {
	repo := NewMemoryRepo()
	companyID := "33333333-3333-4333-8333-333333333431"
	userID := "33333333-3333-4333-8333-333333333432"
	nodeID := "33333333-3333-4333-8333-333333333433"
	sourceType := "direct_user_grant"
	sourceID := "node:" + nodeID + ":user:" + userID
	now := time.Now().UTC()

	repo.mu.Lock()
	addEffectiveAccessFact(repo.effectiveAccess, now, effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionView, sourceType, sourceID))
	err := repo.replaceEffectiveFactsForSourceLocked(companyID, sourceType, sourceID, []domain.EffectiveResourceAccess{
		effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionNoAccess, sourceType, sourceID),
	})
	repo.mu.Unlock()
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("replaceEffectiveFactsForSourceLocked err = %v, want ErrInvalid", err)
	}
	if _, ok := repo.effectiveAccess[effectiveAccessKey(companyID, userID, EntityTypeNode, nodeID, sourceType, sourceID)]; !ok {
		t.Fatalf("existing fact was deleted even though replacement facts were invalid")
	}
}

func TestPostgresEffectiveAccessWriterSourceReplacementUsesScopedDeleteAndKeyConflict(t *testing.T) {
	execer := &fakeEffectiveAccessExecer{}
	companyID := "33333333-3333-4333-8333-333333333501"
	userID := "33333333-3333-4333-8333-333333333502"
	nodeID := "33333333-3333-4333-8333-333333333503"
	gateID := "33333333-3333-4333-8333-333333333504"
	sourceType := "direct_user_grant"
	sourceID := "node:" + nodeID + ":user:" + userID

	err := replaceEffectiveFactsForSourceTx(context.Background(), execer, companyID, sourceType, sourceID, []domain.EffectiveResourceAccess{
		effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionEdit, sourceType, sourceID),
		effectiveAccessWriterFact(companyID, userID, EntityTypeLogicGate, gateID, EntityPermissionView, sourceType, sourceID),
	})
	if err != nil {
		t.Fatalf("replaceEffectiveFactsForSourceTx: %v", err)
	}
	if len(execer.calls) != 3 {
		t.Fatalf("ExecContext calls = %d, want 3", len(execer.calls))
	}
	deleteSQL := normalizeEffectiveAccessSQLForTest(execer.calls[0].query)
	if !strings.Contains(deleteSQL, "where company_id=$1::uuid and source_type=$2 and source_id=$3") {
		t.Fatalf("source replacement delete SQL = %q, want source-scoped delete", deleteSQL)
	}
	if got := execer.calls[0].args; len(got) != 3 || got[0] != companyID || got[1] != sourceType || got[2] != sourceID {
		t.Fatalf("source delete args = %#v, want company/source type/source id", got)
	}
	insertSQL := normalizeEffectiveAccessSQLForTest(execer.calls[1].query)
	if !strings.Contains(insertSQL, "on conflict (company_id, user_id, resource_type, resource_id, source_type, source_id)") {
		t.Fatalf("insert SQL = %q, want effective-access key conflict", insertSQL)
	}
	if !strings.Contains(insertSQL, "mangorts_access_level_rank") {
		t.Fatalf("insert SQL = %q, want strongest-level conflict handling", insertSQL)
	}
}

func TestPostgresEffectiveAccessWriterDeleteHelpersAreScoped(t *testing.T) {
	companyID := "33333333-3333-4333-8333-333333333511"
	nodeID := "33333333-3333-4333-8333-333333333512"
	sourceType := "node_assignee"
	sourceID := "node:" + nodeID + ":assignee:33333333-3333-4333-8333-333333333513"

	sourceExecer := &fakeEffectiveAccessExecer{}
	if err := deleteEffectiveFactsForSourceTx(context.Background(), sourceExecer, companyID, sourceType, sourceID); err != nil {
		t.Fatalf("deleteEffectiveFactsForSourceTx: %v", err)
	}
	sourceSQL := normalizeEffectiveAccessSQLForTest(sourceExecer.calls[0].query)
	if !strings.Contains(sourceSQL, "where company_id=$1::uuid and source_type=$2 and source_id=$3") {
		t.Fatalf("source delete SQL = %q, want source-scoped delete", sourceSQL)
	}

	resourceExecer := &fakeEffectiveAccessExecer{}
	if err := deleteEffectiveFactsForResourceSourceTx(context.Background(), resourceExecer, companyID, EntityTypeNode, nodeID, sourceType); err != nil {
		t.Fatalf("deleteEffectiveFactsForResourceSourceTx: %v", err)
	}
	resourceSQL := normalizeEffectiveAccessSQLForTest(resourceExecer.calls[0].query)
	if !strings.Contains(resourceSQL, "resource_type=$2 and resource_id=$3::uuid and source_type=$4") {
		t.Fatalf("resource/source-family delete SQL = %q, want resource and source-family scoped delete", resourceSQL)
	}
	if strings.Contains(resourceSQL, " and source_id=") {
		t.Fatalf("resource/source-family delete SQL = %q, should not constrain one source id", resourceSQL)
	}
}

func TestPostgresEffectiveAccessWriterInvalidFactsFailBeforeMutation(t *testing.T) {
	execer := &fakeEffectiveAccessExecer{}
	companyID := "33333333-3333-4333-8333-333333333521"
	userID := "33333333-3333-4333-8333-333333333522"
	nodeID := "33333333-3333-4333-8333-333333333523"
	sourceType := "direct_user_grant"
	sourceID := "node:" + nodeID + ":user:" + userID

	err := replaceEffectiveFactsForSourceTx(context.Background(), execer, companyID, sourceType, sourceID, []domain.EffectiveResourceAccess{
		effectiveAccessWriterFact(companyID, userID, EntityTypeNode, nodeID, EntityPermissionNoAccess, sourceType, sourceID),
	})
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("replaceEffectiveFactsForSourceTx err = %v, want ErrInvalid", err)
	}
	if len(execer.calls) != 0 {
		t.Fatalf("ExecContext calls = %d, want no mutation before invalid fact failure", len(execer.calls))
	}
}

func effectiveAccessWriterFact(companyID, userID, resourceType, resourceID, accessLevel, sourceType, sourceID string) domain.EffectiveResourceAccess {
	return domain.EffectiveResourceAccess{
		CompanyID:    companyID,
		UserID:       userID,
		ResourceType: resourceType,
		ResourceID:   resourceID,
		AccessLevel:  accessLevel,
		SourceType:   sourceType,
		SourceID:     sourceID,
	}
}

type fakeEffectiveAccessExecCall struct {
	query string
	args  []any
}

type fakeEffectiveAccessExecer struct {
	calls []fakeEffectiveAccessExecCall
}

func (f *fakeEffectiveAccessExecer) ExecContext(_ context.Context, query string, args ...any) (sql.Result, error) {
	f.calls = append(f.calls, fakeEffectiveAccessExecCall{
		query: query,
		args:  append([]any(nil), args...),
	})
	return fakeEffectiveAccessResult(0), nil
}

type fakeEffectiveAccessResult int64

func (r fakeEffectiveAccessResult) LastInsertId() (int64, error) {
	return 0, nil
}

func (r fakeEffectiveAccessResult) RowsAffected() (int64, error) {
	return int64(r), nil
}

func normalizeEffectiveAccessSQLForTest(query string) string {
	return strings.Join(strings.Fields(query), " ")
}
