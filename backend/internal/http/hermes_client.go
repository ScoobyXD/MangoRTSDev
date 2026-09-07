package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Each route is one independently provisioned Hermes process and persistent home.
// Configuration contains environment variable names, never credentials.
type HermesRoute struct {
	CompanyID      string `json:"company_id"`
	UserID         string `json:"user_id"`
	URL            string `json:"url"`
	APIKeyEnv      string `json:"api_key_env"`
	CallbackKeyEnv string `json:"callback_key_env"`
	APIKey         string `json:"-"`
	CallbackKey    string `json:"-"`
}

func ParseHermesRoutes(raw string, lookup func(string) string) ([]HermesRoute, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var routes []HermesRoute
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&routes); err != nil {
		return nil, errors.New("invalid MANGORTS_HERMES_ROUTES JSON")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return nil, errors.New("invalid MANGORTS_HERMES_ROUTES JSON")
	}
	seenScope, seenURL, seenKey := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for i := range routes {
		route := &routes[i]
		u, err := url.Parse(route.URL)
		if err != nil || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") || u.User != nil || u.RawQuery != "" || u.Fragment != "" || strings.Trim(u.Path, "/") != "" || !isCanonicalUUID(route.CompanyID) || !isCanonicalUUID(route.UserID) {
			return nil, errors.New("invalid Hermes route: exact company/user UUIDs and private HTTP service origin required")
		}
		route.URL = strings.TrimRight(route.URL, "/")
		route.APIKey, route.CallbackKey = strings.TrimSpace(lookup(route.APIKeyEnv)), strings.TrimSpace(lookup(route.CallbackKeyEnv))
		scope := route.CompanyID + ":" + route.UserID
		if len(route.APIKey) < 32 || len(route.CallbackKey) < 32 || route.APIKey == route.CallbackKey || seenScope[scope] || seenURL[strings.ToLower(route.URL)] || seenKey[route.APIKey] || seenKey[route.CallbackKey] {
			return nil, errors.New("Hermes routes require unique scopes, origins, and distinct injected service/callback keys of at least 32 characters")
		}
		seenScope[scope], seenURL[strings.ToLower(route.URL)], seenKey[route.APIKey], seenKey[route.CallbackKey] = true, true, true, true
	}
	return routes, nil
}

func newHermesClient() *http.Client {
	return &http.Client{
		// This origin is a private service. Do not forward its credential through a process proxy.
		Transport:     &http.Transport{ResponseHeaderTimeout: 20 * time.Second, IdleConnTimeout: 90 * time.Second},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

type hermesHTTPError struct{ status int }

func (e hermesHTTPError) Error() string { return "Hermes service request failed" }

func (s *Server) hermesRequest(ctx context.Context, route HermesRoute, method, path, requestID string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, route.URL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+route.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if requestID != "" {
		req.Header.Set("Idempotency-Key", requestID)
	}
	resp, err := s.hermesClient.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, hermesHTTPError{resp.StatusCode}
	}
	return resp, nil
}

func (s *Server) hermesJSON(ctx context.Context, route HermesRoute, method, path, requestID string, body, out any) error {
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	resp, err := s.hermesRequest(ctx, route, method, path, requestID, body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(out)
}

func writeHermesError(w http.ResponseWriter, err error) {
	if errors.Is(err, errAINotDurable) {
		writeError(w, 503, "ai_durable_storage_required")
		return
	}
	var upstream hermesHTTPError
	if errors.As(err, &upstream) {
		switch upstream.status {
		case 404:
			writeError(w, http.StatusNotFound, "ai_run_or_chat_unavailable")
			return
		case 409:
			writeError(w, http.StatusConflict, "ai_request_conflict")
			return
		case 401, 403:
			writeError(w, http.StatusServiceUnavailable, "ai_service_authentication_failed")
			return
		case 429:
			writeError(w, http.StatusTooManyRequests, "ai_busy")
			return
		}
	}
	writeError(w, http.StatusBadGateway, "ai_service_unavailable")
}
