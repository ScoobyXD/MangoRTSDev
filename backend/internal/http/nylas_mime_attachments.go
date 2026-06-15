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
	"strconv"
	"strings"

	"miraeopus/backend/internal/domain"
)

func (s *Server) attachRawMIMEAttachmentsIfMissing(ctx context.Context, connection domain.UserEmailConnection, message NylasMessage) NylasMessage {
	if len(message.Attachments) > 0 || s.nylasClient == nil || strings.TrimSpace(connection.GrantID) == "" || strings.TrimSpace(message.ID) == "" {
		return message
	}
	rawMIME, err := s.nylasClient.GetMessageRawMIME(ctx, connection.GrantID, message.ID)
	if err != nil {
		log.Printf("failed to fetch nylas raw mime attachments user_id=%s message_id=%s: %v", connection.UserID, message.ID, err)
		return message
	}
	attachments := nylasAttachmentsFromRawMIME(rawMIME)
	if len(attachments) == 0 {
		return message
	}
	message.Attachments = attachments
	return message
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
	isInline := disposition == "inline" || (contentID != "" && isImage)
	isAttachment := disposition == "attachment" || filename != "" || isInline
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
