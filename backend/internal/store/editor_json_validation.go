package store

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
)

var editorJSONNodeTypes = map[string]bool{
	"doc": true, "paragraph": true, "heading": true, "blockquote": true,
	"codeBlock": true, "horizontalRule": true, "text": true, "hardBreak": true,
	"bulletList": true, "orderedList": true, "listItem": true, "taskList": true,
	"taskItem": true, "table": true, "tableRow": true, "tableHeader": true,
	"tableCell": true, "mention": true, "mangoEntityLink": true,
	"mangoAttachmentImage": true,
}

var editorJSONMarkTypes = map[string]bool{
	"bold": true, "italic": true, "underline": true, "strike": true, "code": true,
	"textStyle": true, "highlight": true, "link": true,
}

// ValidateMangoTiptapJSON verifies the versioned envelope and the minimum
// structural/safety rules that the configured Tiptap schema cannot enforce on
// the Go server. Cosmetic attributes are deliberately left to ProseMirror.
func ValidateMangoTiptapJSON(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 || editorBytesContainSensitiveContent(raw) {
		return nil, ErrInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var envelope map[string]any
	if err := decoder.Decode(&envelope); err != nil {
		return nil, ErrInvalid
	}
	if len(envelope) != 3 || envelope["format"] != MangoTiptapFormat {
		return nil, ErrInvalid
	}
	version, ok := envelope["schema_version"].(json.Number)
	if !ok || version.String() != "1" {
		return nil, ErrInvalid
	}
	document, ok := envelope["document"].(map[string]any)
	if !ok || document["type"] != "doc" {
		return nil, ErrInvalid
	}
	count := 0
	if err := validateEditorJSONNode(document, "document", 0, &count); err != nil {
		return nil, err
	}
	canonical, err := json.Marshal(envelope)
	if err != nil {
		return nil, ErrInvalid
	}
	return canonical, nil
}

func validateEditorJSONNode(value any, path string, depth int, count *int) error {
	if depth > 100 {
		return fmt.Errorf("%w: %s nested too deeply", ErrInvalid, path)
	}
	node, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("%w: %s must be an object", ErrInvalid, path)
	}
	(*count)++
	if *count > 100000 {
		return fmt.Errorf("%w: too many nodes", ErrInvalid)
	}
	nodeType, ok := node["type"].(string)
	if !ok || !editorJSONNodeTypes[nodeType] {
		return fmt.Errorf("%w: unknown node at %s", ErrInvalid, path)
	}
	for key := range node {
		if key != "type" && key != "attrs" && key != "content" && key != "text" && key != "marks" {
			return fmt.Errorf("%w: unsupported node property", ErrInvalid)
		}
	}
	attrs, err := editorJSONAttributes(node["attrs"])
	if err != nil {
		return err
	}
	if nodeType == "mention" {
		userID, userOK := attrs["userId"].(string)
		label, labelOK := attrs["label"].(string)
		if !userOK || strings.TrimSpace(userID) == "" || !labelOK || strings.TrimSpace(label) == "" {
			return fmt.Errorf("%w: mention identity required", ErrInvalid)
		}
		if kind, exists := attrs["kind"].(string); exists && kind != "normal" && kind != "urgent" {
			return fmt.Errorf("%w: invalid mention kind", ErrInvalid)
		}
	}
	if nodeType == "mangoEntityLink" {
		entityType, typeOK := attrs["entityType"].(string)
		entityID, idOK := attrs["entityId"].(string)
		label, labelOK := attrs["label"].(string)
		if !typeOK || (entityType != "node" && entityType != "logic_gate" && entityType != "project") ||
			!idOK || strings.TrimSpace(entityID) == "" || !labelOK || strings.TrimSpace(label) == "" {
			return fmt.Errorf("%w: entity identity required", ErrInvalid)
		}
	}
	if nodeType == "mangoAttachmentImage" {
		attachmentID, ok := attrs["attachmentId"].(string)
		if !ok || strings.TrimSpace(attachmentID) == "" {
			return fmt.Errorf("%w: image attachmentId required", ErrInvalid)
		}
		for _, item := range attrs {
			if text, ok := item.(string); ok {
				lower := strings.ToLower(strings.TrimSpace(text))
				if strings.HasPrefix(lower, "blob:") || strings.HasPrefix(lower, "data:") {
					return fmt.Errorf("%w: transient image URL", ErrInvalid)
				}
			}
		}
		if href, exists := attrs["linkHref"].(string); exists && href != "" && !safeEditorJSONLink(href) {
			return fmt.Errorf("%w: unsafe image link", ErrInvalid)
		}
	}
	if nodeType == "text" {
		if _, ok := node["text"].(string); !ok {
			return fmt.Errorf("%w: text required", ErrInvalid)
		}
	} else if _, exists := node["text"]; exists {
		return fmt.Errorf("%w: text on non-text node", ErrInvalid)
	}
	if marksValue, exists := node["marks"]; exists {
		if nodeType != "text" && nodeType != "hardBreak" && nodeType != "mention" && nodeType != "mangoEntityLink" {
			return fmt.Errorf("%w: marks on non-inline node", ErrInvalid)
		}
		marks, ok := marksValue.([]any)
		if !ok {
			return fmt.Errorf("%w: invalid marks", ErrInvalid)
		}
		for _, markValue := range marks {
			mark, ok := markValue.(map[string]any)
			if !ok {
				return fmt.Errorf("%w: invalid mark", ErrInvalid)
			}
			markType, ok := mark["type"].(string)
			if !ok || !editorJSONMarkTypes[markType] {
				return fmt.Errorf("%w: unknown mark", ErrInvalid)
			}
			for key := range mark {
				if key != "type" && key != "attrs" {
					return fmt.Errorf("%w: unsupported mark property", ErrInvalid)
				}
			}
			markAttrs, attrErr := editorJSONAttributes(mark["attrs"])
			if attrErr != nil {
				return attrErr
			}
			if markType == "link" {
				href, ok := markAttrs["href"].(string)
				if !ok || !safeEditorJSONLink(href) {
					return fmt.Errorf("%w: unsafe link", ErrInvalid)
				}
			}
		}
	}
	contentValue, exists := node["content"]
	if !exists {
		if nodeType == "doc" {
			return fmt.Errorf("%w: doc content required", ErrInvalid)
		}
		return nil
	}
	content, ok := contentValue.([]any)
	if !ok || editorJSONAtomNode(nodeType) {
		return fmt.Errorf("%w: invalid content", ErrInvalid)
	}
	if editorJSONNonEmptyContainer(nodeType) && len(content) == 0 {
		return fmt.Errorf("%w: empty container", ErrInvalid)
	}
	for index, child := range content {
		childObject, childOK := child.(map[string]any)
		childType, typeOK := childObject["type"].(string)
		if !childOK || !typeOK || !editorJSONChildAllowed(nodeType, childType, index) {
			return fmt.Errorf("%w: invalid %s child in %s", ErrInvalid, childType, nodeType)
		}
		if err := validateEditorJSONNode(child, fmt.Sprintf("%s.content[%d]", path, index), depth+1, count); err != nil {
			return err
		}
	}
	return nil
}

func editorJSONAttributes(value any) (map[string]any, error) {
	if value == nil {
		return map[string]any{}, nil
	}
	attrs, ok := value.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: invalid attributes", ErrInvalid)
	}
	for _, item := range attrs {
		switch typed := item.(type) {
		case nil, string, bool, json.Number:
		case []any:
			for _, member := range typed {
				switch member.(type) {
				case nil, string, bool, json.Number:
				default:
					return nil, fmt.Errorf("%w: invalid attribute array", ErrInvalid)
				}
			}
		default:
			return nil, fmt.Errorf("%w: invalid attribute value", ErrInvalid)
		}
	}
	return attrs, nil
}

func editorJSONAtomNode(nodeType string) bool {
	switch nodeType {
	case "text", "hardBreak", "horizontalRule", "mention", "mangoEntityLink", "mangoAttachmentImage":
		return true
	default:
		return false
	}
}

func editorJSONNonEmptyContainer(nodeType string) bool {
	switch nodeType {
	case "doc", "blockquote", "bulletList", "orderedList", "taskList", "listItem", "taskItem", "table", "tableRow", "tableCell", "tableHeader":
		return true
	default:
		return false
	}
}

func editorJSONBlockNode(nodeType string) bool {
	switch nodeType {
	case "paragraph", "heading", "blockquote", "codeBlock", "horizontalRule", "bulletList", "orderedList", "taskList", "table", "mangoAttachmentImage":
		return true
	default:
		return false
	}
}

func editorJSONChildAllowed(parentType, childType string, index int) bool {
	switch parentType {
	case "paragraph", "heading":
		return childType == "text" || childType == "hardBreak" || childType == "mention" || childType == "mangoEntityLink"
	case "codeBlock":
		return childType == "text"
	case "doc", "blockquote", "tableCell", "tableHeader":
		return editorJSONBlockNode(childType)
	case "bulletList", "orderedList":
		return childType == "listItem"
	case "taskList":
		return childType == "taskItem"
	case "listItem", "taskItem":
		return editorJSONBlockNode(childType) && (index > 0 || childType == "paragraph")
	case "table":
		return childType == "tableRow"
	case "tableRow":
		return childType == "tableCell" || childType == "tableHeader"
	default:
		return false
	}
}

func safeEditorJSONLink(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") ||
		strings.HasPrefix(value, "mailto:") || strings.HasPrefix(value, "tel:") ||
		strings.HasPrefix(value, "/") || strings.HasPrefix(value, "#")
}
