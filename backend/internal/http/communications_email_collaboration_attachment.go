package httpapi

import (
	"context"
	"encoding/base64"
	"mime"
	"miraeopus/backend/internal/domain"
	"net/http"
	"strings"
)

func (s *Server) downloadEmailCollaborationAttachment(
	w http.ResponseWriter,
	r *http.Request,
	connection domain.UserEmailConnection,
	collaboration domain.CommunicationsEmailCollaboration,
	messageID string,
	attachmentID string,
) {
	messageID = strings.TrimSpace(messageID)
	attachmentID = strings.TrimSpace(attachmentID)
	if messageID == "" || attachmentID == "" {
		writeError(w, http.StatusNotFound, "not_found")
		return
	}
	providerThreadID := strings.TrimSpace(collaboration.ProviderThreadID)
	if providerThreadID == "" &&
		messageID != strings.TrimSpace(collaboration.RootMessageID) &&
		messageID != strings.TrimSpace(collaboration.LatestMessageID) &&
		messageID != strings.TrimSpace(collaboration.Message.ID) {
		writeError(w, http.StatusNotFound, "email_attachment_not_found")
		return
	}

	message, err := s.communicationsMessage(r.Context(), connection, messageID)
	if err != nil {
		s.writeNylasError(w, r, connection, err)
		return
	}
	if strings.TrimSpace(message.ID) != messageID ||
		(providerThreadID != "" && strings.TrimSpace(message.ThreadID) != providerThreadID) {
		writeError(w, http.StatusNotFound, "email_attachment_not_found")
		return
	}
	attachment, ok := findNylasAttachmentByID(message.Attachments, attachmentID)
	if !ok {
		writeError(w, http.StatusNotFound, "email_attachment_not_found")
		return
	}

	var content []byte
	if inlineContent := strings.TrimSpace(attachment.Content); inlineContent != "" {
		content, err = base64.StdEncoding.DecodeString(inlineContent)
		if err != nil || len(content) > communicationsAttachmentDownloadMaxBytes {
			writeError(w, http.StatusBadRequest, "invalid_email_attachment")
			return
		}
	} else {
		err = s.withCommunicationsNylasGate(r.Context(), connection, func(ctx context.Context) error {
			var downloadErr error
			content, downloadErr = s.nylasClient.DownloadAttachment(ctx, connection.GrantID, messageID, attachmentID)
			return downloadErr
		})
		if err != nil {
			s.writeNylasError(w, r, connection, err)
			return
		}
	}

	contentType := strings.TrimSpace(attachment.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	filename := strings.TrimSpace(attachment.Filename)
	if filename == "" {
		filename = "attachment"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": filename}))
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(content)
}
