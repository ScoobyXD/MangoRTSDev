package auth

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	ErrMissingToken = errors.New("missing token")
	ErrInvalidToken = errors.New("invalid token")
)

const maxTokenIssuedAtClockSkew = 5 * time.Minute

type Claims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
	Issuer        string
	Client        string
	IssuedAt      time.Time
}

type ValidatorConfig struct {
	Issuer   string
	ClientID string
	TokenUse string
}

type KeySource interface {
	Key(ctx context.Context, kid string) (*rsa.PublicKey, error)
}

type Validator struct {
	config ValidatorConfig
	keys   KeySource
	now    func() time.Time
}

func NewValidator(config ValidatorConfig, keys KeySource) *Validator {
	if config.TokenUse == "" {
		config.TokenUse = "access"
	}
	return &Validator{
		config: config,
		keys:   keys,
		now:    time.Now,
	}
}

func (v *Validator) Validate(ctx context.Context, token string) (Claims, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return Claims{}, ErrMissingToken
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidToken
	}

	var header struct {
		Algorithm string `json:"alg"`
		KeyID     string `json:"kid"`
		Type      string `json:"typ"`
	}
	if err := decodeSegment(parts[0], &header); err != nil {
		return Claims{}, ErrInvalidToken
	}
	if header.Algorithm != "RS256" || strings.TrimSpace(header.KeyID) == "" {
		return Claims{}, ErrInvalidToken
	}

	var raw map[string]any
	if err := decodeSegment(parts[1], &raw); err != nil {
		return Claims{}, ErrInvalidToken
	}

	if getString(raw, "iss") != v.config.Issuer {
		return Claims{}, ErrInvalidToken
	}
	if v.config.TokenUse != "" && !tokenUseAllowed(getString(raw, "token_use"), v.config.TokenUse) {
		return Claims{}, ErrInvalidToken
	}
	client := getString(raw, "client_id")
	if client == "" {
		client = getString(raw, "aud")
	}
	if v.config.ClientID != "" && client != v.config.ClientID {
		return Claims{}, ErrInvalidToken
	}
	subject := getString(raw, "sub")
	if subject == "" {
		return Claims{}, ErrInvalidToken
	}

	now := v.now().Unix()
	if exp, ok := getNumber(raw, "exp"); !ok || now >= int64(exp) {
		return Claims{}, ErrInvalidToken
	}
	if nbf, ok := getNumber(raw, "nbf"); ok && now < int64(nbf) {
		return Claims{}, ErrInvalidToken
	}
	issuedAtValue, ok := getNumber(raw, "iat")
	issuedAtUnix := int64(issuedAtValue)
	if !ok || issuedAtUnix <= 0 || issuedAtUnix > now+int64(maxTokenIssuedAtClockSkew/time.Second) {
		return Claims{}, ErrInvalidToken
	}

	key, err := v.keys.Key(ctx, header.KeyID)
	if err != nil {
		return Claims{}, err
	}
	signed := []byte(parts[0] + "." + parts[1])
	digest := sha256.Sum256(signed)
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return Claims{}, ErrInvalidToken
	}
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		return Claims{}, ErrInvalidToken
	}

	emailVerified, _ := raw["email_verified"].(bool)
	return Claims{
		Subject:       subject,
		Email:         getString(raw, "email"),
		EmailVerified: emailVerified,
		Name:          displayNameFromClaims(raw),
		Issuer:        getString(raw, "iss"),
		Client:        client,
		IssuedAt:      time.Unix(issuedAtUnix, 0).UTC(),
	}, nil
}

type RemoteJWKSource struct {
	url    string
	client *http.Client
	mu     sync.RWMutex
	keys   map[string]*rsa.PublicKey
}

func NewRemoteJWKSource(url string) *RemoteJWKSource {
	return &RemoteJWKSource{
		url:    url,
		client: &http.Client{Timeout: 5 * time.Second},
		keys:   map[string]*rsa.PublicKey{},
	}
}

func (s *RemoteJWKSource) Key(ctx context.Context, kid string) (*rsa.PublicKey, error) {
	s.mu.RLock()
	key := s.keys[kid]
	s.mu.RUnlock()
	if key != nil {
		return key, nil
	}
	if err := s.refresh(ctx); err != nil {
		return nil, err
	}
	s.mu.RLock()
	key = s.keys[kid]
	s.mu.RUnlock()
	if key == nil {
		return nil, ErrInvalidToken
	}
	return key, nil
}

func (s *RemoteJWKSource) refresh(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("jwks fetch failed: %s", res.Status)
	}
	var payload struct {
		Keys []struct {
			KeyID     string `json:"kid"`
			KeyType   string `json:"kty"`
			Algorithm string `json:"alg"`
			Use       string `json:"use"`
			N         string `json:"n"`
			E         string `json:"e"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return err
	}
	next := map[string]*rsa.PublicKey{}
	for _, item := range payload.Keys {
		if item.KeyType != "RSA" || item.N == "" || item.E == "" || item.KeyID == "" {
			continue
		}
		key, err := rsaPublicKeyFromJWK(item.N, item.E)
		if err != nil {
			continue
		}
		next[item.KeyID] = key
	}
	s.mu.Lock()
	s.keys = next
	s.mu.Unlock()
	return nil
}

type StaticKeySource map[string]*rsa.PublicKey

func (s StaticKeySource) Key(_ context.Context, kid string) (*rsa.PublicKey, error) {
	key := s[kid]
	if key == nil {
		return nil, ErrInvalidToken
	}
	return key, nil
}

func decodeSegment(segment string, target any) error {
	raw, err := base64.RawURLEncoding.DecodeString(segment)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func getString(raw map[string]any, key string) string {
	value, _ := raw[key].(string)
	return strings.TrimSpace(value)
}

func displayNameFromClaims(raw map[string]any) string {
	if name := getString(raw, "name"); name != "" {
		return name
	}
	parts := []string{getString(raw, "given_name"), getString(raw, "family_name")}
	return strings.TrimSpace(strings.Join(parts, " "))
}

func tokenUseAllowed(actual, configured string) bool {
	for _, allowed := range strings.Split(configured, ",") {
		if strings.TrimSpace(allowed) == actual {
			return true
		}
	}
	return false
}

func getNumber(raw map[string]any, key string) (float64, bool) {
	switch value := raw[key].(type) {
	case float64:
		return value, true
	case json.Number:
		parsed, err := value.Float64()
		return parsed, err == nil
	default:
		return 0, false
	}
}

func rsaPublicKeyFromJWK(encodedN, encodedE string) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(encodedN)
	if err != nil {
		return nil, err
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(encodedE)
	if err != nil {
		return nil, err
	}
	e := 0
	for _, b := range eBytes {
		e = e<<8 + int(b)
	}
	if e == 0 {
		return nil, ErrInvalidToken
	}
	return &rsa.PublicKey{
		N: new(big.Int).SetBytes(nBytes),
		E: e,
	}, nil
}
