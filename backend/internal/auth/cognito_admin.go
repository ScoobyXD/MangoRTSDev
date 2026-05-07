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
	"os"
	"strings"
	"sync"
	"time"
)

var ErrCognitoAdminUnavailable = errors.New("cognito admin unavailable")

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

func NewCognitoAdminClient(region, userPoolID string) *CognitoAdminClient {
	return &CognitoAdminClient{
		Region:     strings.TrimSpace(region),
		UserPoolID: strings.TrimSpace(userPoolID),
		HTTPClient: &http.Client{Timeout: 5 * time.Second},
	}
}

func (c *CognitoAdminClient) AdminCreateUser(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	if c == nil || c.Region == "" || c.UserPoolID == "" || email == "" {
		return ErrCognitoAdminUnavailable
	}
	body, err := json.Marshal(map[string]any{
		"UserPoolId": c.UserPoolID,
		"Username":   email,
		"DesiredDeliveryMediums": []string{
			"EMAIL",
		},
		"UserAttributes": []map[string]string{
			{"Name": "email", "Value": email},
			{"Name": "email_verified", "Value": "true"},
		},
	})
	if err != nil {
		return err
	}
	creds, err := c.credentials(ctx)
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/", c.Region)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-amz-json-1.1")
	req.Header.Set("X-Amz-Target", "AWSCognitoIdentityProviderService.AdminCreateUser")
	signV4(req, body, creds, c.Region, "cognito-idp", time.Now().UTC())

	client := c.HTTPClient
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
	if strings.Contains(string(raw), "UsernameExistsException") || strings.Contains(res.Header.Get("X-Amzn-Errortype"), "UsernameExistsException") {
		return nil
	}
	return fmt.Errorf("cognito admin create user failed: status=%d", res.StatusCode)
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

	host := req.URL.Host
	canonicalHeaders := "content-type:" + strings.TrimSpace(req.Header.Get("Content-Type")) + "\n" +
		"host:" + host + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "content-type;host;x-amz-date"
	if creds.SessionToken != "" {
		canonicalHeaders += "x-amz-security-token:" + creds.SessionToken + "\n"
		signedHeaders += ";x-amz-security-token"
	}
	canonicalHeaders += "x-amz-target:" + strings.TrimSpace(req.Header.Get("X-Amz-Target")) + "\n"
	signedHeaders += ";x-amz-target"

	canonicalRequest := strings.Join([]string{
		req.Method,
		"/",
		"",
		canonicalHeaders,
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
