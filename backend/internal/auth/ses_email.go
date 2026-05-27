package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

type SESEmailSender struct {
	Region           string
	FromEmailAddress string
	HTTPClient       *http.Client

	mu     sync.Mutex
	cached awsCredentials
}

type InvitationEmailInput struct {
	Email             string
	CompanyName       string
	AcceptURL         string
	TemporaryPassword string
	ExpiresAt         time.Time
}

func NewSESEmailSender(region, fromEmailAddress string) *SESEmailSender {
	return &SESEmailSender{
		Region:           strings.TrimSpace(region),
		FromEmailAddress: strings.TrimSpace(fromEmailAddress),
		HTTPClient:       &http.Client{Timeout: 5 * time.Second},
	}
}

func (s *SESEmailSender) SendInvitation(ctx context.Context, input InvitationEmailInput) error {
	companyName := strings.TrimSpace(input.CompanyName)
	if companyName == "" {
		companyName = "your company"
	}
	acceptURL := strings.TrimSpace(input.AcceptURL)
	subject := "You're invited to MangoRTS"
	var body strings.Builder
	body.WriteString("You have been invited to MangoRTS for ")
	body.WriteString(companyName)
	body.WriteString(".\n\nOpen this link to accept the invitation:\n")
	body.WriteString(acceptURL)
	body.WriteString("\n\n")
	if password := strings.TrimSpace(input.TemporaryPassword); password != "" {
		body.WriteString("Temporary password:\n")
		body.WriteString(password)
		body.WriteString("\n\nUse this temporary password once, then set a new password on the invite page.\n")
	} else {
		body.WriteString("Sign in with your existing MangoRTS password when prompted.\n")
	}
	if !input.ExpiresAt.IsZero() {
		body.WriteString("\nThis invitation expires on ")
		body.WriteString(input.ExpiresAt.UTC().Format("2006-01-02 15:04 UTC"))
		body.WriteString(".\n")
	}
	return s.sendTextEmail(ctx, input.Email, subject, body.String())
}

func (s *SESEmailSender) SendSignupConfirmation(ctx context.Context, email, companyName string) error {
	companyName = strings.TrimSpace(companyName)
	if companyName == "" {
		companyName = "your company"
	}
	subject := "MangoRTS signup complete"
	body := fmt.Sprintf("You have successfully signed up with %s.", companyName)
	return s.sendTextEmail(ctx, email, subject, body)
}

func (s *SESEmailSender) sendTextEmail(ctx context.Context, email, subject, bodyText string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if s == nil || s.Region == "" || s.FromEmailAddress == "" || email == "" || strings.TrimSpace(subject) == "" || strings.TrimSpace(bodyText) == "" {
		return ErrCognitoAdminUnavailable
	}
	payload := map[string]any{
		"FromEmailAddress": s.FromEmailAddress,
		"Destination": map[string]any{
			"ToAddresses": []string{email},
		},
		"Content": map[string]any{
			"Simple": map[string]any{
				"Subject": map[string]string{
					"Data":    subject,
					"Charset": "UTF-8",
				},
				"Body": map[string]any{
					"Text": map[string]string{
						"Data":    bodyText,
						"Charset": "UTF-8",
					},
				},
			},
		},
	}
	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	creds, err := s.credentials(ctx)
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("https://email.%s.amazonaws.com/v2/email/outbound-emails", s.Region)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(rawPayload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	signV4(req, rawPayload, creds, s.Region, "ses", time.Now().UTC())

	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 200 && res.StatusCode <= 299 {
		return nil
	}
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if detail := strings.TrimSpace(string(raw)); detail != "" {
		return fmt.Errorf("ses send email failed: status=%d body=%s", res.StatusCode, detail)
	}
	return fmt.Errorf("ses send email failed: status=%d", res.StatusCode)
}

func (s *SESEmailSender) credentials(ctx context.Context) (awsCredentials, error) {
	s.mu.Lock()
	if s.cached.AccessKeyID != "" && (s.cached.Expiration.IsZero() || time.Until(s.cached.Expiration) > 5*time.Minute) {
		creds := s.cached
		s.mu.Unlock()
		return creds, nil
	}
	s.mu.Unlock()

	if env := credentialsFromEnv(); env.AccessKeyID != "" {
		s.mu.Lock()
		s.cached = env
		s.mu.Unlock()
		return env, nil
	}
	creds, err := s.credentialsFromContainer(ctx)
	if err != nil {
		return awsCredentials{}, err
	}
	s.mu.Lock()
	s.cached = creds
	s.mu.Unlock()
	return creds, nil
}

func (s *SESEmailSender) credentialsFromContainer(ctx context.Context) (awsCredentials, error) {
	uri := strings.TrimSpace(os.Getenv("AWS_CONTAINER_CREDENTIALS_FULL_URI"))
	if uri == "" {
		relative := strings.TrimSpace(os.Getenv("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"))
		if relative != "" {
			uri = "http://169.254.170.2" + relative
		}
	}
	if uri == "" {
		return awsCredentials{}, ErrCognitoAdminUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return awsCredentials{}, err
	}
	if token := strings.TrimSpace(os.Getenv("AWS_CONTAINER_AUTHORIZATION_TOKEN")); token != "" {
		req.Header.Set("Authorization", token)
	}
	client := s.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return awsCredentials{}, err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return awsCredentials{}, ErrCognitoAdminUnavailable
	}
	var payload struct {
		AccessKeyID     string    `json:"AccessKeyId"`
		SecretAccessKey string    `json:"SecretAccessKey"`
		Token           string    `json:"Token"`
		Expiration      time.Time `json:"Expiration"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return awsCredentials{}, err
	}
	if payload.AccessKeyID == "" || payload.SecretAccessKey == "" {
		return awsCredentials{}, ErrCognitoAdminUnavailable
	}
	return awsCredentials{
		AccessKeyID:     payload.AccessKeyID,
		SecretAccessKey: payload.SecretAccessKey,
		SessionToken:    payload.Token,
		Expiration:      payload.Expiration,
	}, nil
}
