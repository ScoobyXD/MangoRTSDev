package httpapi

import "testing"

func TestIsLegalNodeRelationshipPositionPair(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name string
		a    string
		b    string
		want bool
	}{
		{name: "parent_child", a: "Parent", b: "Child", want: true},
		{name: "child_parent", a: "Child", b: "Parent", want: true},
		{name: "peer_peer", a: "Peer", b: "Peer", want: true},
		{name: "parent_parent", a: "Parent", b: "Parent", want: false},
		{name: "child_child", a: "Child", b: "Child", want: false},
		{name: "parent_peer", a: "Parent", b: "Peer", want: false},
		{name: "peer_child", a: "Peer", b: "Child", want: false},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := isLegalNodeRelationshipPositionPair(tc.a, tc.b)
			if got != tc.want {
				t.Fatalf("isLegalNodeRelationshipPositionPair(%q, %q) = %t, want %t", tc.a, tc.b, got, tc.want)
			}
		})
	}
}
