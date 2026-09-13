package store

import "testing"

func TestCtrlLoopAttachmentOwnerShape(t *testing.T) {
	valid := ResourceAttachmentInput{CompanyID: NewUUIDv7String(), ResourceType: "ctrl_loop_job", ResourceID: NewUUIDv7String(), AttachmentID: NewUUIDv7String(), RelationshipKind: AttachmentRelationshipFileAttachment}
	if _, err := normalizeResourceAttachmentInput(valid); err != nil {
		t.Fatal(err)
	}
	for _, mutation := range []func(*ResourceAttachmentInput){
		func(i *ResourceAttachmentInput) { i.ResourceID = "surrogate-job" },
		func(i *ResourceAttachmentInput) { i.ResourceType = "ctrl-loop-job" },
		func(i *ResourceAttachmentInput) { i.RelationshipKind = AttachmentRelationshipInlineImage },
		func(i *ResourceAttachmentInput) { i.InformationID = NewUUIDv7String() },
		func(i *ResourceAttachmentInput) { i.InformationID = "invalid-but-present" },
		func(i *ResourceAttachmentInput) { i.MessageID = "message" },
		func(i *ResourceAttachmentInput) { i.EditorSurface = "editor" },
	} {
		input := valid
		mutation(&input)
		if _, err := normalizeResourceAttachmentInput(input); err != ErrInvalid {
			t.Fatalf("accepted invalid owner %+v: %v", input, err)
		}
	}
}
