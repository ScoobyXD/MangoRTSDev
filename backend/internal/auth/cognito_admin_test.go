package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCognitoAdminAcceptInvitationRejectsExistingAccount(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")

	transport := &recordingRoundTripper{
		responses: []roundTripResponse{
			{status: http.StatusBadRequest, body: `{"__type":"UsernameExistsException","message":"User account already exists"}`},
		},
	}
	client := &CognitoAdminClient{
		Region:     "us-west-1",
		UserPoolID: "us-west-1_test",
		HTTPClient: &http.Client{Transport: transport},
	}

	_, err := client.AdminAcceptInvitation(context.Background(), "user@example.com", "Replacement123!")
	if !errors.Is(err, ErrCognitoAccountExists) {
		t.Fatalf("existing account error = %v, want ErrCognitoAccountExists", err)
	}
	if len(transport.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(transport.requests))
	}
	if action := stringField(t, transport.requests[0], "MessageAction"); action != "SUPPRESS" {
		t.Fatalf("first MessageAction = %q, want SUPPRESS", action)
	}
}

func TestCognitoAdminAcceptInvitationSetsPermanentPasswordAndReturnsSubject(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")

	transport := &recordingRoundTripper{
		responses: []roundTripResponse{
			{status: http.StatusOK, body: `{}`},
			{status: http.StatusOK, body: `{}`},
			{status: http.StatusOK, body: `{"Username":"user@example.com","UserAttributes":[{"Name":"sub","Value":"subject-123"},{"Name":"email","Value":"USER@EXAMPLE.COM"}]}`},
		},
	}
	client := &CognitoAdminClient{
		Region:     "us-west-1",
		UserPoolID: "us-west-1_test",
		HTTPClient: &http.Client{Transport: transport},
	}

	const password = "  NewPassw0rd!  "
	result, err := client.AdminAcceptInvitation(context.Background(), "USER@EXAMPLE.COM", password)
	if err != nil {
		t.Fatal(err)
	}
	if result.Subject != "subject-123" || result.Email != "user@example.com" {
		t.Fatalf("result = %+v, want subject and lowercased email", result)
	}
	if len(transport.requests) != 3 {
		t.Fatalf("requests = %d, want 3", len(transport.requests))
	}
	if username := stringField(t, transport.requests[0], "Username"); username != "user@example.com" {
		t.Fatalf("Username = %q, want lowercased email", username)
	}
	if email := userAttributeField(t, transport.requests[0], "email"); email != "user@example.com" {
		t.Fatalf("email attribute = %q, want lowercased email", email)
	}
	if action := stringField(t, transport.requests[0], "MessageAction"); action != "SUPPRESS" {
		t.Fatalf("MessageAction = %q, want SUPPRESS", action)
	}
	if got := stringField(t, transport.requests[0], "TemporaryPassword"); got != password {
		t.Fatal("temporary password differs from submitted password")
	}
	if got := stringField(t, transport.requests[1], "Password"); got != password {
		t.Fatal("permanent password differs from submitted password")
	}
	if permanent, _ := transport.requests[1]["Permanent"].(bool); !permanent {
		t.Fatalf("Permanent = %v, want true", transport.requests[1]["Permanent"])
	}
	if username := stringField(t, transport.requests[2], "Username"); username != "user@example.com" {
		t.Fatalf("AdminGetUser Username = %q, want lowercased email", username)
	}
}

func TestCognitoAdminAcceptInvitationRejectsWeakPasswordBeforeSettingPassword(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")
	transport := &recordingRoundTripper{responses: []roundTripResponse{
		{status: http.StatusBadRequest, body: `{"__type":"InvalidPasswordException","message":"Password does not conform to policy","request_details":"must-not-be-exposed"}`},
	}}
	client := &CognitoAdminClient{Region: "us-west-1", UserPoolID: "us-west-1_test", HTTPClient: &http.Client{Transport: transport}}
	result, err := client.AdminAcceptInvitation(context.Background(), "new@example.test", "weak")
	var passwordError *CognitoInvalidPasswordError
	if !errors.As(err, &passwordError) || result.Subject != "" {
		t.Fatalf("weak password acceptance result=%+v err=%v", result, err)
	}
	if passwordError.Error() != "Password does not conform to policy" {
		t.Fatalf("password error exposed more than the provider message: %q", passwordError.Error())
	}
	if len(transport.requests) != 1 {
		t.Fatalf("weak password made %d requests, want create only", len(transport.requests))
	}
	if got := stringField(t, transport.requests[0], "TemporaryPassword"); got != "weak" {
		t.Fatal("creation did not validate the submitted password")
	}
}

func TestCognitoAdminConcurrentInvitationAcceptSetsOnlyCreatorPassword(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")
	transport := &concurrentInvitationRoundTripper{bothStarted: make(chan struct{})}
	client := &CognitoAdminClient{Region: "us-west-1", UserPoolID: "us-west-1_test", HTTPClient: &http.Client{Transport: transport}}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	results := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := client.AdminAcceptInvitation(ctx, "racing@example.test", "ChosenPass123!")
			results <- err
		}()
	}
	successes, conflicts := 0, 0
	for range 2 {
		switch err := <-results; {
		case err == nil:
			successes++
		case errors.Is(err, ErrCognitoAccountExists):
			conflicts++
		default:
			t.Fatalf("racing invite accept: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 || transport.passwordCalls.Load() != 1 {
		t.Fatalf("racing accepts success=%d conflicts=%d password calls=%d", successes, conflicts, transport.passwordCalls.Load())
	}
}

type concurrentInvitationRoundTripper struct {
	createCalls   atomic.Int32
	passwordCalls atomic.Int32
	bothStarted   chan struct{}
}

func (r *concurrentInvitationRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	defer req.Body.Close()
	status, body := http.StatusOK, `{}`
	switch {
	case strings.HasSuffix(req.Header.Get("X-Amz-Target"), ".AdminCreateUser"):
		attempt := r.createCalls.Add(1)
		if attempt == 2 {
			close(r.bothStarted)
		}
		select {
		case <-r.bothStarted:
		case <-req.Context().Done():
			return nil, req.Context().Err()
		}
		if attempt != 1 {
			status, body = http.StatusBadRequest, `{"__type":"UsernameExistsException"}`
		}
	case strings.HasSuffix(req.Header.Get("X-Amz-Target"), ".AdminSetUserPassword"):
		r.passwordCalls.Add(1)
	case strings.HasSuffix(req.Header.Get("X-Amz-Target"), ".AdminGetUser"):
		body = `{"UserAttributes":[{"Name":"sub","Value":"created-subject"},{"Name":"email","Value":"racing@example.test"}]}`
	}
	return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: req}, nil
}

func TestCognitoAdminDeleteUserTreatsMissingAsDeleted(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")

	transport := &recordingRoundTripper{
		responses: []roundTripResponse{
			{status: http.StatusBadRequest, body: `{"__type":"UserNotFoundException","message":"User does not exist"}`},
		},
	}
	client := &CognitoAdminClient{
		Region:     "us-west-1",
		UserPoolID: "us-west-1_test",
		HTTPClient: &http.Client{Transport: transport},
	}

	if err := client.AdminDeleteUser(context.Background(), "USER@EXAMPLE.COM"); err != nil {
		t.Fatal(err)
	}
	if len(transport.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(transport.requests))
	}
	if username := stringField(t, transport.requests[0], "Username"); username != "user@example.com" {
		t.Fatalf("Username = %q, want lowercased email", username)
	}
}

func TestCognitoAdminDeleteUserPreservesCognitoSubject(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")

	transport := &recordingRoundTripper{
		responses: []roundTripResponse{
			{status: http.StatusOK, body: `{}`},
		},
	}
	client := &CognitoAdminClient{
		Region:     "us-west-1",
		UserPoolID: "us-west-1_test",
		HTTPClient: &http.Client{Transport: transport},
	}

	const subject = "1939c95e-2021-700c-10f7-e03ae12e81aa"
	if err := client.AdminDeleteUser(context.Background(), subject); err != nil {
		t.Fatal(err)
	}
	if len(transport.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(transport.requests))
	}
	if username := stringField(t, transport.requests[0], "Username"); username != subject {
		t.Fatalf("Username = %q, want Cognito subject", username)
	}
}

type roundTripResponse struct {
	status int
	body   string
}

type recordingRoundTripper struct {
	requests  []map[string]any
	responses []roundTripResponse
}

func (r *recordingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	defer req.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
		return nil, err
	}
	r.requests = append(r.requests, payload)

	index := len(r.requests) - 1
	response := roundTripResponse{status: http.StatusOK, body: `{}`}
	if index < len(r.responses) {
		response = r.responses[index]
	}
	return &http.Response{
		StatusCode: response.status,
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewBufferString(response.body)),
		Request:    req,
	}, nil
}

func stringField(t *testing.T, payload map[string]any, name string) string {
	t.Helper()
	value, _ := payload[name].(string)
	return value
}

func userAttributeField(t *testing.T, payload map[string]any, name string) string {
	t.Helper()
	attributes, ok := payload["UserAttributes"].([]any)
	if !ok {
		t.Fatalf("UserAttributes = %#v, want list", payload["UserAttributes"])
	}
	for _, item := range attributes {
		attribute, _ := item.(map[string]any)
		if attribute["Name"] == name {
			value, _ := attribute["Value"].(string)
			return value
		}
	}
	return ""
}
