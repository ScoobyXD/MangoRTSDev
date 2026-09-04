package httpapi

import (
	"encoding/json"
	"miraeopus/backend/internal/store"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestProcessMapChangesHTTPValidatesAndNeverReturnsPrivateDamage(t *testing.T) {
	fixture := newProcessMapHTTPFixture(t)
	path := "/v1/process-map/placements/logic_gate/" + fixture.processA.LogicGateID + "?company_id=" + fixture.companyID
	first := fixture.request(t, fixture.admin, http.MethodPut, path, `{"map_parent_folder_id":null,"grid_x":64,"grid_y":64,"grid_width":32,"grid_height":32}`, nil)
	if first.Code != http.StatusOK {
		t.Fatalf("first save: %d %s", first.Code, first.Body.String())
	}
	var envelope store.ProcessMapMutationEnvelope
	if err := json.Unmarshal(first.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	second := fixture.request(t, fixture.admin, http.MethodPut, path, `{"map_parent_folder_id":null,"grid_x":600,"grid_y":64,"grid_width":32,"grid_height":32}`, nil)
	if second.Code != http.StatusOK {
		t.Fatalf("second save: %d %s", second.Code, second.Body.String())
	}
	if strings.Contains(second.Body.String(), "process_map_damage") || strings.Contains(second.Body.String(), `"events"`) {
		t.Fatalf("private event data leaked: %s", second.Body.String())
	}
	version := strconv.FormatInt(envelope.ProcessMapReadVersion, 10)
	body := `{"company_id":"` + fixture.companyID + `","since_version":` + version + `,"tiles":[{"z":` + strconv.Itoa(store.ProcessMapMaxTileZoom) + `,"x":4,"y":0,"process_map_read_version":` + version + `}]}`
	response := fixture.request(t, fixture.admin, http.MethodPost, "/v1/process-map/changes", body, nil)
	if response.Code != http.StatusOK {
		t.Fatalf("changes: %d %s", response.Code, response.Body.String())
	}
	var changes store.ProcessMapChanges
	if err := json.Unmarshal(response.Body.Bytes(), &changes); err != nil {
		t.Fatal(err)
	}
	if changes.ProtectedGeometryChanged || len(changes.ValidatedTiles) != 1 {
		t.Fatalf("unrelated cached tile not certified: %+v", changes)
	}
	if strings.Contains(response.Body.String(), "process_map_damage") || strings.Contains(response.Body.String(), "resource_id") {
		t.Fatal("changes response leaked private identities/geometry")
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("changes response must not be HTTP cached")
	}
	for _, malformed := range []string{`{}`, `{"company_id":"` + fixture.companyID + `","tiles":[]}`, `{"company_id":"` + fixture.companyID + `","since_version":0}`, `{"company_id":"` + fixture.companyID + `","since_version":0,"tiles":[],"unexpected":true}`} {
		if response := fixture.request(t, fixture.admin, http.MethodPost, "/v1/process-map/changes", malformed, nil); response.Code != http.StatusBadRequest {
			t.Fatalf("malformed request accepted: %s: %d", malformed, response.Code)
		}
	}
	if response := fixture.request(t, fixture.admin, http.MethodGet, "/v1/process-map/changes", "", nil); response.Code != http.StatusMethodNotAllowed {
		t.Fatal("changes read accepted wrong method")
	}
}
