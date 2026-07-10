package httpapi

import (
	"context"
	"encoding/base64"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net/mail"
	"net/textproto"
	"path"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"miraeopus/backend/internal/domain"
)

func (s *Server) attachRawMIMEAttachmentsIfMissing(ctx context.Context, connection domain.UserEmailConnection, message NylasMessage) NylasMessage {
	if message.RawMIMEAttachmentsRecovered || !messageNeedsRawMIMEAttachmentRecovery(message) || s.nylasClient == nil || strings.TrimSpace(connection.GrantID) == "" || strings.TrimSpace(message.ID) == "" {
		return message
	}
	rawMIME, err := s.nylasClient.GetMessageRawMIME(ctx, connection.GrantID, message.ID)
	if err != nil {
		log.Printf("communications_attachment_raw_mime outcome=fetch_failed user_id=%s provider=%s account_email=%s scope=%s message_id=%s grant=%s err=%v", connection.UserID, connection.Provider, connection.AccountEmail, connection.Scope, message.ID, grantIDLogValue(connection.GrantID), err)
		return message
	}
	message.RawMIMEAttachmentsRecovered = true
	attachments := nylasAttachmentsFromRawMIME(rawMIME)
	if len(attachments) == 0 {
		log.Printf("communications_attachment_raw_mime outcome=no_attachments user_id=%s provider=%s account_email=%s scope=%s message_id=%s grant=%s raw_mime_bytes=%d", connection.UserID, connection.Provider, connection.AccountEmail, connection.Scope, message.ID, grantIDLogValue(connection.GrantID), len(rawMIME))
		return message
	}
	if len(message.Attachments) == 0 {
		message.Attachments = attachments
		log.Printf("communications_attachment_raw_mime outcome=attachments_recovered user_id=%s provider=%s account_email=%s scope=%s message_id=%s grant=%s attachment_count=%d raw_mime_bytes=%d", connection.UserID, connection.Provider, connection.AccountEmail, connection.Scope, message.ID, grantIDLogValue(connection.GrantID), len(attachments), len(rawMIME))
		return message
	}
	merged, changed := mergeRawMIMEAttachments(message.Attachments, attachments, rawMIMEBodyCIDReferences(message.Body))
	if !changed {
		log.Printf("communications_attachment_raw_mime outcome=no_merge_needed user_id=%s provider=%s account_email=%s scope=%s message_id=%s grant=%s raw_attachment_count=%d raw_mime_bytes=%d", connection.UserID, connection.Provider, connection.AccountEmail, connection.Scope, message.ID, grantIDLogValue(connection.GrantID), len(attachments), len(rawMIME))
		return message
	}
	message.Attachments = merged
	log.Printf("communications_attachment_raw_mime outcome=attachments_merged user_id=%s provider=%s account_email=%s scope=%s message_id=%s grant=%s attachment_count=%d raw_attachment_count=%d raw_mime_bytes=%d", connection.UserID, connection.Provider, connection.AccountEmail, connection.Scope, message.ID, grantIDLogValue(connection.GrantID), len(merged), len(attachments), len(rawMIME))
	return message
}

var rawMIMEBodyCIDPattern = regexp.MustCompile(`(?i)\bcid:([^"'\s>)]+)`)

func messageNeedsRawMIMEAttachmentRecovery(message NylasMessage) bool {
	if message.RawMIMEAttachmentsRecovered {
		return false
	}
	if len(message.Attachments) == 0 {
		return true
	}
	if !slices.ContainsFunc(message.Attachments, rawMIMEAttachmentIsCalendar) {
		return true
	}
	refs := rawMIMEBodyCIDReferences(message.Body)
	if len(refs) == 0 {
		return false
	}
	for ref := range refs {
		attachment, ok := findRawMIMEAttachmentByContentID(message.Attachments, ref)
		if !ok || strings.TrimSpace(attachment.Content) == "" {
			return true
		}
	}
	return false
}

func rawMIMEBodyCIDReferences(body string) map[string]bool {
	refs := map[string]bool{}
	for _, match := range rawMIMEBodyCIDPattern.FindAllStringSubmatch(body, -1) {
		if len(match) < 2 {
			continue
		}
		if ref := normalizeRawMIMEContentID(match[1]); ref != "" {
			refs[ref] = true
		}
	}
	return refs
}

func findRawMIMEAttachmentByContentID(attachments []NylasAttachment, contentID string) (NylasAttachment, bool) {
	target := normalizeRawMIMEContentID(contentID)
	if target == "" {
		return NylasAttachment{}, false
	}
	for _, attachment := range attachments {
		if normalizeRawMIMEContentID(attachment.ContentID) == target {
			return attachment, true
		}
	}
	return NylasAttachment{}, false
}

func mergeRawMIMEAttachments(existing, recovered []NylasAttachment, referencedContentIDs map[string]bool) ([]NylasAttachment, bool) {
	merged := append([]NylasAttachment(nil), existing...)
	changed := false
	for _, raw := range recovered {
		contentID := normalizeRawMIMEContentID(raw.ContentID)
		if contentID != "" {
			if index := rawMIMEAttachmentIndexByContentID(merged, contentID); index >= 0 {
				next := mergeRawMIMEAttachment(merged[index], raw)
				if next != merged[index] {
					merged[index] = next
					changed = true
				}
				continue
			}
			if !referencedContentIDs[contentID] {
				continue
			}
			merged = append(merged, raw)
			changed = true
			continue
		}
		if rawMIMEAttachmentIsCalendar(raw) && !slices.ContainsFunc(merged, rawMIMEAttachmentIsCalendar) {
			merged = append(merged, raw)
			changed = true
		}
	}
	return merged, changed
}

func rawMIMEAttachmentIsCalendar(attachment NylasAttachment) bool {
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(attachment.ContentType, ";")[0]))
	return contentType == "text/calendar" || strings.HasSuffix(strings.ToLower(strings.TrimSpace(attachment.Filename)), ".ics")
}

func rawMIMEAttachmentIndexByContentID(attachments []NylasAttachment, contentID string) int {
	for index, attachment := range attachments {
		if normalizeRawMIMEContentID(attachment.ContentID) == contentID {
			return index
		}
	}
	return -1
}

func mergeRawMIMEAttachment(existing, raw NylasAttachment) NylasAttachment {
	merged := existing
	if strings.TrimSpace(merged.ID) == "" {
		merged.ID = strings.TrimSpace(raw.ID)
	}
	if strings.TrimSpace(merged.AttachmentID) == "" {
		merged.AttachmentID = strings.TrimSpace(raw.AttachmentID)
	}
	if strings.TrimSpace(merged.Filename) == "" {
		merged.Filename = strings.TrimSpace(raw.Filename)
	}
	if strings.TrimSpace(merged.ContentType) == "" {
		merged.ContentType = strings.TrimSpace(raw.ContentType)
	}
	if strings.TrimSpace(merged.Content) == "" {
		merged.Content = strings.TrimSpace(raw.Content)
	}
	if strings.TrimSpace(merged.ContentID) == "" {
		merged.ContentID = strings.TrimSpace(raw.ContentID)
	}
	if strings.TrimSpace(merged.ContentDisposition) == "" {
		merged.ContentDisposition = strings.TrimSpace(raw.ContentDisposition)
	}
	if !merged.IsInline {
		merged.IsInline = raw.IsInline
	}
	if merged.Size <= 0 {
		merged.Size = raw.Size
	}
	return merged
}

func nylasAttachmentsFromRawMIME(rawMIME string) []NylasAttachment {
	rawMIME = strings.TrimSpace(rawMIME)
	if rawMIME == "" {
		return nil
	}
	message, err := mail.ReadMessage(strings.NewReader(rawMIME))
	if err != nil {
		return nil
	}
	attachments := []NylasAttachment{}
	collectRawMIMEAttachments(textproto.MIMEHeader(message.Header), message.Body, &attachments)
	return attachments
}

func collectRawMIMEAttachments(header textproto.MIMEHeader, body io.Reader, attachments *[]NylasAttachment) {
	contentType := strings.TrimSpace(header.Get("Content-Type"))
	if contentType == "" {
		contentType = "text/plain"
	}
	mediaType, contentParams, err := mime.ParseMediaType(contentType)
	if err != nil {
		mediaType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
		contentParams = map[string]string{}
	}
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))

	if strings.HasPrefix(mediaType, "multipart/") {
		boundary := strings.TrimSpace(contentParams["boundary"])
		if boundary == "" {
			return
		}
		reader := multipart.NewReader(body, boundary)
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				return
			}
			if err != nil {
				return
			}
			collectRawMIMEAttachments(part.Header, part, attachments)
		}
	}

	disposition, dispositionParams := parseMIMEDisposition(header.Get("Content-Disposition"))
	filename := strings.TrimSpace(dispositionParams["filename"])
	if filename == "" {
		filename = strings.TrimSpace(contentParams["name"])
	}
	contentID := cleanRawMIMEContentID(header.Get("Content-ID"))
	isImage := strings.HasPrefix(mediaType, "image/")
	isCalendar := mediaType == "text/calendar" || strings.HasSuffix(strings.ToLower(filename), ".ics")
	isInline := disposition == "inline" || (contentID != "" && isImage)
	isAttachment := disposition == "attachment" || filename != "" || isInline || isCalendar
	if !isAttachment {
		return
	}

	content, ok := readDecodedRawMIMEPart(header, body)
	if !ok || len(content) == 0 {
		return
	}
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	position := len(*attachments) + 1
	filename = rawMIMEAttachmentFilename(filename, mediaType, position)
	if disposition == "" {
		if isInline {
			disposition = "inline"
		} else {
			disposition = "attachment"
		}
	}
	*attachments = append(*attachments, NylasAttachment{
		ID:                 "raw-mime-" + strconv.Itoa(position),
		Filename:           filename,
		ContentType:        mediaType,
		Content:            base64.StdEncoding.EncodeToString(content),
		ContentID:          contentID,
		ContentDisposition: disposition,
		IsInline:           isInline,
		Size:               int64(len(content)),
	})
}

func parseMIMEDisposition(raw string) (string, map[string]string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", map[string]string{}
	}
	disposition, params, err := mime.ParseMediaType(raw)
	if err != nil {
		return strings.ToLower(strings.TrimSpace(strings.Split(raw, ";")[0])), map[string]string{}
	}
	return strings.ToLower(strings.TrimSpace(disposition)), params
}

func readDecodedRawMIMEPart(header textproto.MIMEHeader, body io.Reader) ([]byte, bool) {
	var reader io.Reader = body
	switch strings.ToLower(strings.TrimSpace(header.Get("Content-Transfer-Encoding"))) {
	case "base64":
		reader = base64.NewDecoder(base64.StdEncoding, body)
	case "quoted-printable":
		reader = quotedprintable.NewReader(body)
	}
	content, err := io.ReadAll(io.LimitReader(reader, communicationsAttachmentDownloadMaxBytes+1))
	if err != nil || len(content) > communicationsAttachmentDownloadMaxBytes {
		return nil, false
	}
	return content, true
}

func cleanRawMIMEContentID(raw string) string {
	return strings.Trim(strings.TrimSpace(raw), "<>")
}

func normalizeRawMIMEContentID(raw string) string {
	clean := strings.TrimSpace(raw)
	clean = strings.TrimPrefix(strings.ToLower(clean), "cid:")
	clean = strings.Trim(strings.TrimSpace(clean), "<>\"'")
	return clean
}

func rawMIMEAttachmentFilename(filename, contentType string, position int) string {
	filename = strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/"))
	if filename != "" {
		filename = path.Base(filename)
	}
	if filename != "" && filename != "." && filename != "/" {
		return filename
	}
	extension := ".bin"
	if extensions, err := mime.ExtensionsByType(contentType); err == nil && len(extensions) > 0 {
		extension = extensions[0]
	}
	return "attachment-" + strconv.Itoa(position) + extension
}
