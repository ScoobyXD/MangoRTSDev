package store

import (
	"encoding/json"
	"strings"
	"time"
)

const (
	editorJSONMetadataMaxBytes      = 64 * 1024
	editorTextBlockProjectionPrefix = "<!-- mango-node-text-block-v1 -->"
)

type EditorDocumentRef struct {
	CompanyID    string `json:"company_id"`
	ResourceType string `json:"resource_type"`
	ResourceID   string `json:"resource_id"`
	DocumentID   string `json:"document_id"`
}

type EditorJSONAttachmentReference struct {
	ID           string `json:"id"`
	AttachmentID string `json:"attachment_id"`
	Name         string `json:"name"`
	Filename     string `json:"filename"`
	Type         string `json:"type"`
	MIMEType     string `json:"mime_type"`
	Size         int64  `json:"size"`
	ByteSize     int64  `json:"byte_size"`
}

type EditorJSONMetadataInput struct {
	Document       EditorDocumentRef               `json:"document"`
	Title          string                          `json:"title"`
	Attachments    []EditorJSONAttachmentReference `json:"attachments"`
	EmailMessageID string                          `json:"email_message_id"`
	Color          string                          `json:"color"`
	EmailAccent    string                          `json:"email_accent"`
}

type EditorJSONMetadataCommit struct {
	ProjectionRevision int64     `json:"projection_revision"`
	UpdatedTimestamp   time.Time `json:"updated_timestamp"`
}

func NormalizeEditorJSONMetadata(input EditorJSONMetadataInput) (EditorJSONMetadataInput, error) {
	ref, err := NormalizeEditorDocumentRef(input.Document)
	if err != nil {
		return EditorJSONMetadataInput{}, err
	}
	input.Document = ref
	input.Title = strings.TrimSpace(input.Title)
	input.EmailMessageID = strings.TrimSpace(input.EmailMessageID)
	input.Color = strings.ToUpper(strings.TrimSpace(input.Color))
	input.EmailAccent = strings.TrimSpace(input.EmailAccent)
	if len(input.Title) > 500 || len(input.Attachments) > 100 || len(input.EmailMessageID) > 500 {
		return EditorJSONMetadataInput{}, ErrInvalid
	}
	if input.Document.ResourceType == EntityTypeNode {
		if (input.Color != "" && !validEmailTextboxColor(input.Color)) || input.EmailAccent != "" {
			return EditorJSONMetadataInput{}, ErrInvalid
		}
	} else if input.Document.ResourceType == EntityTypeProject {
		if input.Color != "" || input.EmailMessageID != "" || input.EmailAccent != "" {
			return EditorJSONMetadataInput{}, ErrInvalid
		}
	} else if input.Color != "" || (input.EmailAccent != "" && !validEditorEmailAccent(input.EmailAccent)) {
		return EditorJSONMetadataInput{}, ErrInvalid
	}
	for index := range input.Attachments {
		item := &input.Attachments[index]
		item.ID = strings.TrimSpace(item.ID)
		item.AttachmentID = strings.TrimSpace(item.AttachmentID)
		item.Name = strings.TrimSpace(item.Name)
		item.Filename = strings.TrimSpace(item.Filename)
		item.Type = strings.TrimSpace(item.Type)
		item.MIMEType = strings.TrimSpace(item.MIMEType)
		if item.AttachmentID == "" {
			item.AttachmentID = item.ID
		}
		if item.ID == "" {
			item.ID = item.AttachmentID
		}
		if item.Filename == "" {
			item.Filename = item.Name
		}
		if item.Name == "" {
			item.Name = item.Filename
		}
		if item.MIMEType == "" {
			item.MIMEType = item.Type
		}
		if item.Type == "" {
			item.Type = item.MIMEType
		}
		if item.ByteSize == 0 {
			item.ByteSize = item.Size
		}
		if item.Size == 0 {
			item.Size = item.ByteSize
		}
		if item.ID == "" || item.AttachmentID == "" || item.Name == "" || len(item.ID) > 160 || len(item.AttachmentID) > 160 || len(item.Name) > 500 || len(item.Type) > 200 || item.Size < 0 || item.ByteSize < 0 || item.Size != item.ByteSize {
			return EditorJSONMetadataInput{}, ErrInvalid
		}
	}
	encoded, err := json.Marshal(input.Attachments)
	if err != nil || len(encoded) > editorJSONMetadataMaxBytes || editorBytesContainSensitiveContent(encoded) {
		return EditorJSONMetadataInput{}, ErrInvalid
	}
	return input, nil
}

func validEditorEmailAccent(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}

func editorProjectionInformationWithJSONMetadata(input EditorJSONMetadataInput, document string) (string, error) {
	payload := map[string]any{"title": input.Title, "document": document, "attachments": input.Attachments}
	if input.Document.ResourceType == EntityTypeNode {
		payload["color"] = input.Color
	} else if input.Document.ResourceType == EntityTypeLogicGate {
		payload["email_message_id"] = input.EmailMessageID
		payload["email_accent"] = input.EmailAccent
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return editorTextBlockProjectionPrefix + string(encoded), nil
}

func NormalizeEditorDocumentRef(ref EditorDocumentRef) (EditorDocumentRef, error) {
	ref.CompanyID = strings.TrimSpace(ref.CompanyID)
	ref.ResourceType = strings.TrimSpace(ref.ResourceType)
	ref.ResourceID = strings.TrimSpace(ref.ResourceID)
	ref.DocumentID = strings.TrimSpace(ref.DocumentID)
	if ref.CompanyID == "" || ref.ResourceID == "" || ref.DocumentID == "" {
		return EditorDocumentRef{}, ErrInvalid
	}
	switch ref.ResourceType {
	case EntityTypeNode, EntityTypeLogicGate, EntityTypeProject:
	default:
		return EditorDocumentRef{}, ErrInvalid
	}
	return ref, nil
}

func editorBytesContainSensitiveContent(value []byte) bool {
	lower := strings.ToLower(string(value))
	for _, forbidden := range []string{"data:image/", ";base64,", "x-amz-credential", "x-amz-signature", "awsaccesskeyid", "presigned_url", "secret_access_key"} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}

func EditorRealtimeScope(ref EditorDocumentRef) string {
	ref, err := NormalizeEditorDocumentRef(ref)
	if err != nil {
		return ""
	}
	return "editor:" + ref.ResourceType + ":" + ref.ResourceID + ":" + ref.DocumentID
}
