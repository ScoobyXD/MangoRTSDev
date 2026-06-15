package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
)

func TestCognitoAdminCreateUserSendsInitialInvite(t *testing.T) {
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

	result, err := client.AdminCreateUser(context.Background(), "USER@EXAMPLE.COM")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "created" {
		t.Fatalf("result = %+v, want created status", result)
	}
	if len(transport.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(transport.requests))
	}
	if username := stringField(t, transport.requests[0], "Username"); username != "user@example.com" {
		t.Fatalf("Username = %q, want lowercased email", username)
	}
	if action := stringField(t, transport.requests[0], "MessageAction"); action != "SUPPRESS" {
		t.Fatalf("MessageAction = %q, want SUPPRESS", action)
	}
	if _, ok := transport.requests[0]["TemporaryPassword"]; ok {
		t.Fatalf("TemporaryPassword was sent: %+v", transport.requests[0])
	}
}

func TestCognitoAdminCreateUserResendsExistingInvite(t *testing.T) {
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

	result, err := client.AdminCreateUser(context.Background(), "user@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != "resent" {
		t.Fatalf("result = %+v, want resent status", result)
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
			{status: http.StatusBadRequest, body: `{"__type":"UsernameExistsException","message":"User account already exists"}`},
			{status: http.StatusOK, body: `{}`},
			{status: http.StatusOK, body: `{"Username":"user@example.com","UserAttributes":[{"Name":"sub","Value":"subject-123"},{"Name":"email","Value":"USER@EXAMPLE.COM"}]}`},
		},
	}
	client := &CognitoAdminClient{
		Region:     "us-west-1",
		UserPoolID: "us-west-1_test",
		HTTPClient: &http.Client{Transport: transport},
	}

	result, err := client.AdminAcceptInvitation(context.Background(), "USER@EXAMPLE.COM", "NewPassw0rd!")
	if err != nil {
		t.Fatal(err)
	}
	if result.Subject != "subject-123" || result.Email != "user@example.com" {
		t.Fatalf("result = %+v, want subject and lowercased email", result)
	}
	if len(transport.requests) != 3 {
		t.Fatalf("requests = %d, want 3", len(transport.requests))
	}
	if password := stringField(t, transport.requests[1], "Password"); password != "NewPassw0rd!" {
		t.Fatalf("Password = %q, want submitted password", password)
	}
	if permanent, _ := transport.requests[1]["Permanent"].(bool); !permanent {
		t.Fatalf("Permanent = %v, want true", transport.requests[1]["Permanent"])
	}
	if username := stringField(t, transport.requests[2], "Username"); username != "user@example.com" {
		t.Fatalf("AdminGetUser Username = %q, want lowercased email", username)
	}
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
