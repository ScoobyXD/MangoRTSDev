package store

import (
	"context"

	"miraeopus/backend/internal/domain"
)

func (r *MemoryRepo) AICreateNodeChat(ctx context.Context, run AIRun, actionKey string, input AINodeChatCreateInput) (domain.NodeInformation, error) {
	write, err := aiNodeChatInput(run, input)
	if err != nil {
		return domain.NodeInformation{}, err
	}
	return memoryAIMutation(r, ctx, run, aiActionKey{"mango_create_node_chat", actionKey}, func() bool {
		return r.userHasEffectiveAccessLocked(run.CompanyID, run.UserID, EntityTypeNode, write.NodeID, EntityPermissionEdit)
	}, func() (domain.NodeInformation, error) {
		document, exists, err := r.editorJSONDocumentLocked(EditorJSONDocumentRef{
			CompanyID: run.CompanyID, ResourceType: EntityTypeNode, ResourceID: write.NodeID, DocumentID: cleanUUIDText(input.TextboxID),
		})
		if err != nil {
			return domain.NodeInformation{}, err
		}
		if !exists || document.Deleted {
			return domain.NodeInformation{}, ErrNotFound
		}
		return r.addNodeInformationLocked(write)
	})
}
