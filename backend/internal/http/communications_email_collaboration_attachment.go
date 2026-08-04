package httpapi

import (
	"errors"
	"miraeopus/backend/internal/domain"
	"miraeopus/backend/internal/store"
	"net/http"
	"strings"
)

func (s *Server) downloadEmailCollaborationAttachment(
	w http.ResponseWriter,
	r *http.Request,
	collaboration domain.CommunicationsEmailCollaboration,
	messageID string,
	attachmentID string,
) {
	messageID = strings.TrimSpace(messageID)
	attachmentID = strings.TrimSpace(attachmentID)
	if messageID == "" || attachmentID == "" || messageID != strings.TrimSpace(collaboration.RootMessageID) {
		writeError(w, http.StatusNotFound, "email_attachment_not_found")
		return
	}
	thread, err := s.repo.GetCommunicationsEmailThread(collaboration.CompanyID, collaboration.EmailThreadID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "email_attachment_not_found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed_to_load_email_attachment")
		return
	}
	mangoAttachmentID := ""
	for _, stored := range thread.Messages {
		if stored.EmailMessageID != collaboration.RootMessageID {
			continue
		}
		for _, attachment := range stored.Message.Attachments {
			if attachment.ID == attachmentID || attachment.AttachmentID == attachmentID {
				mangoAttachmentID = strings.TrimSpace(attachment.AttachmentID)
				break
			}
		}
	}
	if mangoAttachmentID == "" {
		writeError(w, http.StatusNotFound, "email_attachment_not_found")
		return
	}
	s.handleAttachmentContent(w, r, mangoAttachmentID)
}
