package httpapi

import (
	"errors"
	"testing"
)

func TestValidateDurablePayloadNoInlineFileBytesRejectsInlineDataURLs(t *testing.T) {
	tests := []struct {
		name    string
		payload string
	}{
		{
			name:    "image data URL",
			payload: `<img src="data:image/png;base64,aGVsbG8=">`,
		},
		{
			name:    "application data URL",
			payload: `{"href":"data:application/pdf;base64,JVBERg=="}`,
		},
		{
			name:    "durable dataURL field",
			payload: `{"attachments":[{"name":"contract.pdf","dataURL":"data:application/pdf;base64,JVBERg=="}]}`,
		},
		{
			name:    "email attachment content",
			payload: `{"attachments":[{"filename":"large.txt","content_type":"text/plain","content":"aGVsbG8="}]}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateDurablePayloadNoInlineFileBytes("test_surface", tt.payload)
			if !errors.Is(err, errDurableInlineFileBytes) {
				t.Fatalf("error = %v, want %v", err, errDurableInlineFileBytes)
			}
		})
	}
}

func TestValidateDurablePayloadNoInlineFileBytesAllowsAttachmentReferences(t *testing.T) {
	payload := `{"attachments":[{"attachment_id":"11111111-1111-5111-8111-111111111111","name":"contract.pdf","mime_type":"application/pdf","byte_size":12}],"body":"mango-attachment:11111111-1111-5111-8111-111111111111"}`
	if err := validateDurablePayloadNoInlineFileBytes("test_surface", payload); err != nil {
		t.Fatalf("error = %v, want nil", err)
	}
}
