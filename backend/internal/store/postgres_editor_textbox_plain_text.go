package store

import (
	"encoding/json"
	"strings"
)

func postgresEditorTextboxPlainText(raw json.RawMessage) string {
	var envelope map[string]any
	if json.Unmarshal(raw, &envelope) != nil {
		return ""
	}
	var result strings.Builder
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case []any:
			for _, child := range typed {
				visit(child)
			}
		case map[string]any:
			nodeType, _ := typed["type"].(string)
			if nodeType == "text" {
				if text, ok := typed["text"].(string); ok {
					result.WriteString(text)
				}
			}
			if nodeType == "hardBreak" {
				result.WriteByte('\n')
			}
			visit(typed["content"])
			switch nodeType {
			case "paragraph", "heading", "listItem", "taskItem", "blockquote", "codeBlock", "tableRow":
				result.WriteByte('\n')
			}
		}
	}
	visit(envelope["document"])
	return strings.TrimSpace(result.String())
}
