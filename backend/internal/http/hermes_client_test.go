package httpapi

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestHermesProfilesShareOneGatewayAndDeriveDistinctCredentials(t *testing.T) {
	configured := []HermesRoute{
		{CompanyID: "11111111-1111-4111-8111-111111111111", UserID: "22222222-2222-4222-8222-222222222222", URL: "http://localhost:8642", APIKeyEnv: "API", CallbackKeyEnv: "CALLBACK"},
		{CompanyID: "11111111-1111-4111-8111-111111111111", UserID: "abcdefab-cdef-4abc-8def-abcdefabcdef", URL: "http://localhost:8642", APIKeyEnv: "API", CallbackKeyEnv: "CALLBACK"},
	}
	lookup := func(name string) string {
		if name == "API" {
			return strings.Repeat("a", 32)
		}
		return strings.Repeat("b", 32)
	}
	parse := func(input []HermesRoute) ([]HermesRoute, error) {
		data, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		return ParseHermesRoutes(string(data), lookup)
	}
	routes, err := parse(configured)
	if err != nil || len(routes) != 2 {
		t.Fatalf("shared gateway rejected: %+v %v", routes, err)
	}
	if routes[0].URL != routes[1].URL || routes[0].profileName() == routes[1].profileName() || routes[0].APIKey == routes[1].APIKey || routes[0].CallbackKey == routes[1].CallbackKey || routes[0].APIKey == routes[0].CallbackKey {
		t.Fatal("profiles did not isolate API and callback credentials on one origin")
	}
	// Cross-language fixtures from Python hmac.new(seed, prefix+profile, sha256).
	if routes[0].APIKey != "be19dac666ffb118ab75bbe9e7eb8ae508bd768a0663ec1b2b6109b70219e630" || routes[0].CallbackKey != "3549ad0eeb03af76547039b031664551719346f09b519bef2b962d87a2fd89c2" {
		t.Fatal("profile keys differ from the Python gateway derivation")
	}
	configured[1].UserID = strings.ToUpper(configured[1].UserID)
	uppercase, err := parse(configured)
	if err != nil || uppercase[1].profileName() != routes[1].profileName() || uppercase[1].APIKey != routes[1].APIKey {
		t.Fatalf("UUID casing changed profile identity: %v", err)
	}
	duplicate := append(append([]HermesRoute{}, configured...), routes[1])
	if _, err := parse(duplicate); err == nil {
		t.Fatal("UUID casing admitted a duplicate company/user profile")
	}
	configured[1].URL = "http://localhost:8643"
	if _, err := parse(configured); err == nil {
		t.Fatal("multiple gateway origins accepted")
	}
}
