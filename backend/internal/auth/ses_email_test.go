package auth

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSESEmailSenderDoesNotSignMissingAmzTarget(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "test-access-key")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "test-secret-key")

	transport := &sesRecordingRoundTripper{}
	sender := &SESEmailSender{
		Region:           "us-west-1",
		FromEmailAddress: "sender@example.com",
		HTTPClient:       &http.Client{Transport: transport},
	}
	if err := sender.SendInvitation(context.Background(), InvitationEmailInput{
		Email:       "USER@EXAMPLE.COM",
		CompanyName: "Acme",
		AcceptURL:   "https://app.example.com/accept-invite?token=test",
		ExpiresAt:   time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatal(err)
	}
	if transport.authorization == "" {
		t.Fatal("authorization header is empty")
	}
	if strings.Contains(strings.ToLower(transport.authorization), "x-amz-target") {
		t.Fatalf("authorization = %q, must not sign x-amz-target for SES v2 REST", transport.authorization)
	}
	if target := transport.headers.Get("X-Amz-Target"); target != "" {
		t.Fatalf("X-Amz-Target = %q, want absent", target)
	}
	if transport.path != "/v2/email/outbound-emails" {
		t.Fatalf("request path = %q, want SES v2 outbound email path", transport.path)
	}
}

func TestSESEmailSenderReportsMissingCredentials(t *testing.T) {
	t.Setenv("AWS_ACCESS_KEY_ID", "")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "")
	t.Setenv("AWS_SESSION_TOKEN", "")
	t.Setenv("AWS_CONTAINER_CREDENTIALS_FULL_URI", "")
	t.Setenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "")
	t.Setenv("AWS_CONTAINER_AUTHORIZATION_TOKEN", "")

	sender := &SESEmailSender{
		Region:           "us-west-1",
		FromEmailAddress: "sender@example.com",
	}
	err := sender.SendInvitation(context.Background(), InvitationEmailInput{
		Email:       "user@example.com",
		CompanyName: "Acme",
		AcceptURL:   "https://app.example.com/accept-invite?token=test",
		ExpiresAt:   time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC),
	})
	if err == nil {
		t.Fatal("SendInvitation succeeded without AWS credentials")
	}
	if got := err.Error(); got != "ses email unavailable: AWS credentials are not configured" {
		t.Fatalf("error = %q, want missing AWS credentials detail", got)
	}
}

func TestSignV4UsesRequestPathAndOptionalTargetHeader(t *testing.T) {
	creds := awsCredentials{AccessKeyID: "test-access-key", SecretAccessKey: "test-secret-key"}
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	body := []byte(`{"ok":true}`)

	firstReq, err := http.NewRequest(http.MethodPost, "https://email.us-west-1.amazonaws.com/v2/email/outbound-emails", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	firstReq.Header.Set("Content-Type", "application/json")
	signV4(firstReq, body, creds, "us-west-1", "ses", now)
	firstAuth := firstReq.Header.Get("Authorization")
	if strings.Contains(strings.ToLower(firstAuth), "x-amz-target") {
		t.Fatalf("SES signed headers include x-amz-target: %s", firstAuth)
	}

	secondReq, err := http.NewRequest(http.MethodPost, "https://email.us-west-1.amazonaws.com/", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	secondReq.Header.Set("Content-Type", "application/json")
	signV4(secondReq, body, creds, "us-west-1", "ses", now)
	if firstAuth == secondReq.Header.Get("Authorization") {
		t.Fatal("signatures match for different request paths; canonical URI was not included")
	}

	cognitoReq, err := http.NewRequest(http.MethodPost, "https://cognito-idp.us-west-1.amazonaws.com/", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	cognitoReq.Header.Set("Content-Type", "application/x-amz-json-1.1")
	cognitoReq.Header.Set("X-Amz-Target", "AWSCognitoIdentityProviderService.AdminCreateUser")
	signV4(cognitoReq, body, creds, "us-west-1", "cognito-idp", now)
	if !strings.Contains(strings.ToLower(cognitoReq.Header.Get("Authorization")), "x-amz-target") {
		t.Fatalf("Cognito signed headers did not include x-amz-target: %s", cognitoReq.Header.Get("Authorization"))
	}
}

type sesRecordingRoundTripper struct {
	headers       http.Header
	authorization string
	path          string
}

func (r *sesRecordingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	defer req.Body.Close()
	r.headers = req.Header.Clone()
	r.authorization = req.Header.Get("Authorization")
	r.path = req.URL.EscapedPath()
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(bytes.NewBufferString(`{}`)),
		Request:    req,
	}, nil
}
