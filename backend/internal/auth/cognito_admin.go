package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrCognitoAdminUnavailable = errors.New("cognito admin unavailable")
	ErrCognitoAccountExists    = errors.New("cognito account already exists")
)

type CognitoInvalidPasswordError struct {
	Message string
}

func (e *CognitoInvalidPasswordError) Error() string {
	if message := strings.TrimSpace(e.Message); message != "" {
		return message
	}
	return "Choose a password that meets the account password requirements."
}

type CognitoAdminClient struct {
	Region     string
	UserPoolID string
	HTTPClient *http.Client

	mu     sync.Mutex
	cached awsCredentials
}

type awsCredentials struct {
	AccessKeyID     string
	SecretAccessKey string
	SessionToken    string
	Expiration      time.Time
}

type CognitoAdminAcceptInvitationResult struct {
	Subject string
	Email   string
}

func NewCognitoAdminClient(region, userPoolID string) *CognitoAdminClient {
	return &CognitoAdminClient{
		Region:     strings.TrimSpace(region),
		UserPoolID: strings.TrimSpace(userPoolID),
		HTTPClient: &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *CognitoAdminClient) AdminAcceptInvitation(ctx context.Context, email, password string) (CognitoAdminAcceptInvitationResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if c == nil || c.Region == "" || c.UserPoolID == "" || email == "" || strings.TrimSpace(password) == "" {
		return CognitoAdminAcceptInvitationResult{}, ErrCognitoAdminUnavailable
	}
	if err := c.adminCreateUser(ctx, email, password); err != nil {
		return CognitoAdminAcceptInvitationResult{}, err
	}
	if err := c.adminSetUserPassword(ctx, email, password, true); err != nil {
		return CognitoAdminAcceptInvitationResult{}, err
	}
	user, err := c.adminGetUser(ctx, email)
	if err != nil {
		return CognitoAdminAcceptInvitationResult{}, err
	}
	if strings.TrimSpace(user.Subject) == "" {
		return CognitoAdminAcceptInvitationResult{}, fmt.Errorf("cognito admin get user missing sub")
	}
	return user, nil
}

func (c *CognitoAdminClient) adminCreateUser(ctx context.Context, email, password string) error {
	payload := map[string]any{
		"UserPoolId":        c.UserPoolID,
		"Username":          email,
		"TemporaryPassword": password,
		"MessageAction":     "SUPPRESS",
		"UserAttributes": []map[string]string{
			{"Name": "email", "Value": email},
			{"Name": "email_verified", "Value": "true"},
		},
	}
	statusCode, header, raw, err := c.cognitoPost(ctx, "AdminCreateUser", payload)
	if err != nil {
		return err
	}
	if statusCode >= 200 && statusCode <= 299 {
		return nil
	}
	var providerError struct {
		Type    string `json:"__type"`
		Message string `json:"message"`
	}
	parsed := json.Unmarshal(raw, &providerError) == nil
	if strings.Contains(header.Get("X-Amzn-Errortype"), "InvalidPasswordException") || (parsed && strings.Contains(providerError.Type, "InvalidPasswordException")) {
		passwordError := &CognitoInvalidPasswordError{}
		if parsed {
			passwordError.Message = providerError.Message
		}
		return passwordError
	}
	if strings.Contains(string(raw), "UsernameExistsException") || strings.Contains(header.Get("X-Amzn-Errortype"), "UsernameExistsException") {
		return ErrCognitoAccountExists
	}
	if detail := strings.TrimSpace(string(raw)); detail != "" {
		return fmt.Errorf("cognito admin create user failed: status=%d body=%s", statusCode, detail)
	}
	return fmt.Errorf("cognito admin create user failed: status=%d", statusCode)
}

func (c *CognitoAdminClient) adminSetUserPassword(ctx context.Context, email, password string, permanent bool) error {
	payload := map[string]any{
		"UserPoolId": c.UserPoolID,
		"Username":   email,
		"Password":   password,
		"Permanent":  permanent,
	}
	statusCode, _, raw, err := c.cognitoPost(ctx, "AdminSetUserPassword", payload)
	if err != nil {
		return err
	}
	if statusCode >= 200 && statusCode <= 299 {
		return nil
	}
	if detail := strings.TrimSpace(string(raw)); detail != "" {
		return fmt.Errorf("cognito admin set user password failed: status=%d body=%s", statusCode, detail)
	}
	return fmt.Errorf("cognito admin set user password failed: status=%d", statusCode)
}

func (c *CognitoAdminClient) adminGetUser(ctx context.Context, email string) (CognitoAdminAcceptInvitationResult, error) {
	payload := map[string]any{
		"UserPoolId": c.UserPoolID,
		"Username":   email,
	}
	statusCode, _, raw, err := c.cognitoPost(ctx, "AdminGetUser", payload)
	if err != nil {
		return CognitoAdminAcceptInvitationResult{}, err
	}
	if statusCode < 200 || statusCode > 299 {
		if detail := strings.TrimSpace(string(raw)); detail != "" {
			return CognitoAdminAcceptInvitationResult{}, fmt.Errorf("cognito admin get user failed: status=%d body=%s", statusCode, detail)
		}
		return CognitoAdminAcceptInvitationResult{}, fmt.Errorf("cognito admin get user failed: status=%d", statusCode)
	}
	var response struct {
		Username       string `json:"Username"`
		UserAttributes []struct {
			Name  string `json:"Name"`
			Value string `json:"Value"`
		} `json:"UserAttributes"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		return CognitoAdminAcceptInvitationResult{}, err
	}
	result := CognitoAdminAcceptInvitationResult{Email: email}
	for _, attribute := range response.UserAttributes {
		switch attribute.Name {
		case "sub":
			result.Subject = strings.TrimSpace(attribute.Value)
		case "email":
			if value := strings.ToLower(strings.TrimSpace(attribute.Value)); value != "" {
				result.Email = value
			}
		}
	}
	return result, nil
}

func (c *CognitoAdminClient) AdminDeleteUser(ctx context.Context, username string) error {
	username = normalizeCognitoUsername(username)
	if c == nil || c.Region == "" || c.UserPoolID == "" || username == "" {
		return ErrCognitoAdminUnavailable
	}
	payload := map[string]any{
		"UserPoolId": c.UserPoolID,
		"Username":   username,
	}
	statusCode, header, raw, err := c.cognitoPost(ctx, "AdminDeleteUser", payload)
	if err != nil {
		return err
	}
	if statusCode >= 200 && statusCode <= 299 {
		return nil
	}
	if strings.Contains(string(raw), "UserNotFoundException") || strings.Contains(header.Get("X-Amzn-Errortype"), "UserNotFoundException") {
		return nil
	}
	if detail := strings.TrimSpace(string(raw)); detail != "" {
		return fmt.Errorf("cognito admin delete user failed: status=%d body=%s", statusCode, detail)
	}
	return fmt.Errorf("cognito admin delete user failed: status=%d", statusCode)
}

func normalizeCognitoUsername(value string) string {
	value = strings.TrimSpace(value)
	if strings.Contains(value, "@") {
		return strings.ToLower(value)
	}
	return value
}

func (c *CognitoAdminClient) cognitoPost(ctx context.Context, action string, payload map[string]any) (int, http.Header, []byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return 0, nil, nil, err
	}
	creds, err := c.credentials(ctx)
	if err != nil {
		return 0, nil, nil, err
	}
	endpoint := fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/", c.Region)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return 0, nil, nil, err
	}
	req.Header.Set("Content-Type", "application/x-amz-json-1.1")
	req.Header.Set("X-Amz-Target", "AWSCognitoIdentityProviderService."+action)
	signV4(req, body, creds, c.Region, "cognito-idp", time.Now().UTC())

	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	res, err := client.Do(req)
	if err != nil {
		return 0, nil, nil, err
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	return res.StatusCode, res.Header, raw, nil
}

func (c *CognitoAdminClient) credentials(ctx context.Context) (awsCredentials, error) {
	c.mu.Lock()
	if c.cached.AccessKeyID != "" && (c.cached.Expiration.IsZero() || time.Until(c.cached.Expiration) > 5*time.Minute) {
		creds := c.cached
		c.mu.Unlock()
		return creds, nil
	}
	c.mu.Unlock()

	if env := credentialsFromEnv(); env.AccessKeyID != "" {
		c.mu.Lock()
		c.cached = env
		c.mu.Unlock()
		return env, nil
	}
	creds, err := c.credentialsFromContainer(ctx)
	if err != nil {
		return awsCredentials{}, err
	}
	c.mu.Lock()
	c.cached = creds
	c.mu.Unlock()
	return creds, nil
}

func credentialsFromEnv() awsCredentials {
	accessKeyID := strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID"))
	secretAccessKey := strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY"))
	if accessKeyID == "" || secretAccessKey == "" {
		return awsCredentials{}
	}
	return awsCredentials{
		AccessKeyID:     accessKeyID,
		SecretAccessKey: secretAccessKey,
		SessionToken:    strings.TrimSpace(os.Getenv("AWS_SESSION_TOKEN")),
	}
}

func (c *CognitoAdminClient) credentialsFromContainer(ctx context.Context) (awsCredentials, error) {
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
	client := c.HTTPClient
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

func signV4(req *http.Request, body []byte, creds awsCredentials, region, service string, now time.Time) {
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	payloadHash := sha256Hex(body)
	req.Header.Set("X-Amz-Date", amzDate)
	if creds.SessionToken != "" {
		req.Header.Set("X-Amz-Security-Token", creds.SessionToken)
	}

	type signedHeader struct {
		name  string
		value string
	}
	headers := []signedHeader{
		{name: "host", value: req.URL.Host},
		{name: "x-amz-date", value: amzDate},
	}
	if contentType := strings.TrimSpace(req.Header.Get("Content-Type")); contentType != "" {
		headers = append(headers, signedHeader{name: "content-type", value: contentType})
	}
	if creds.SessionToken != "" {
		headers = append(headers, signedHeader{name: "x-amz-security-token", value: strings.TrimSpace(creds.SessionToken)})
	}
	if target := strings.TrimSpace(req.Header.Get("X-Amz-Target")); target != "" {
		headers = append(headers, signedHeader{name: "x-amz-target", value: target})
	}
	sort.Slice(headers, func(i, j int) bool {
		return headers[i].name < headers[j].name
	})
	var canonicalHeaders strings.Builder
	signedHeaderNames := make([]string, 0, len(headers))
	for _, header := range headers {
		canonicalHeaders.WriteString(header.name)
		canonicalHeaders.WriteByte(':')
		canonicalHeaders.WriteString(header.value)
		canonicalHeaders.WriteByte('\n')
		signedHeaderNames = append(signedHeaderNames, header.name)
	}
	signedHeaders := strings.Join(signedHeaderNames, ";")
	canonicalURI := req.URL.EscapedPath()
	if canonicalURI == "" {
		canonicalURI = "/"
	}

	canonicalRequest := strings.Join([]string{
		req.Method,
		canonicalURI,
		canonicalQueryString(req.URL.Query()),
		canonicalHeaders.String(),
		signedHeaders,
		payloadHash,
	}, "\n")
	scope := dateStamp + "/" + region + "/" + service + "/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		scope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(hmacSHA256(signingKey(creds.SecretAccessKey, dateStamp, region, service), []byte(stringToSign)))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+creds.AccessKeyID+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
}

func canonicalQueryString(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	parts := make([]string, 0)
	for key, items := range values {
		encodedKey := awsQueryEscape(key)
		if len(items) == 0 {
			parts = append(parts, encodedKey+"=")
			continue
		}
		for _, value := range items {
			parts = append(parts, encodedKey+"="+awsQueryEscape(value))
		}
	}
	sort.Strings(parts)
	return strings.Join(parts, "&")
}

func awsQueryEscape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func sha256Hex(value []byte) string {
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func signingKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, data []byte) []byte {
	mac := hmac.New(sha256.New, key)
	mac.Write(data)
	return mac.Sum(nil)
}
