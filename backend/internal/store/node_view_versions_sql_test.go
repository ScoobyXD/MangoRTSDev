package store

import (
	"os"
	"strings"
	"testing"
)

func TestNodeViewVersionSourceHasNoUnreadChangeCoupling(t *testing.T) {
	for _, filename := range []string{"postgres_node_view_versions.go", "node_view_versions.go", "consolidated_views.go"} {
		body, err := os.ReadFile(filename)
		if err != nil {
			t.Fatalf("ReadFile %s: %v", filename, err)
		}
		source := strings.ToLower(string(body))
		for _, retired := range []string{
			"node_content_changes",
			"node_content_change_seen",
			"node_textbox_seen_snapshots",
			"anchorcleannodeprojections",
			"listunseennodecontentchanges",
			"marknodecontentchangeseen",
		} {
			if strings.Contains(source, retired) {
				t.Fatalf("%s retains unread-change coupling %q", filename, retired)
			}
		}
	}
}
