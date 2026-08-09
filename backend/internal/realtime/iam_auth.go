package realtime

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/signer/v4"
)

const (
	elastiCacheServiceName = "elasticache"
	iamTokenLifetime       = 15 * time.Minute
	emptyBodySHA256        = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)

type AuthCredentials struct {
	Username string
	Password string
}

type AuthProvider interface {
	Credentials(ctx context.Context) (AuthCredentials, error)
}

type IAMAuthProvider struct {
	cacheName   string
	userID      string
	region      string
	credentials aws.CredentialsProvider
	signer      *v4.Signer
	now         func() time.Time
}

func NewIAMAuthProvider(cacheName, userID, region string, credentials aws.CredentialsProvider) (*IAMAuthProvider, error) {
	cacheName = strings.ToLower(strings.TrimSpace(cacheName))
	userID = strings.TrimSpace(userID)
	region = strings.TrimSpace(region)
	if cacheName == "" || userID == "" || region == "" || credentials == nil {
		return nil, errors.New("Valkey IAM cache name, user ID, region, and credentials provider are required")
	}
	return &IAMAuthProvider{
		cacheName: cacheName, userID: userID, region: region, credentials: credentials,
		signer: v4.NewSigner(), now: time.Now,
	}, nil
}

func (p *IAMAuthProvider) Credentials(ctx context.Context) (AuthCredentials, error) {
	if p == nil || p.credentials == nil || p.signer == nil {
		return AuthCredentials{}, errors.New("Valkey IAM authentication is not configured")
	}
	credentials, err := p.credentials.Retrieve(ctx)
	if err != nil {
		return AuthCredentials{}, err
	}
	requestURL := &url.URL{Scheme: "http", Host: p.cacheName, Path: "/"}
	query := requestURL.Query()
	query.Set("Action", "connect")
	query.Set("User", p.userID)
	query.Set("ResourceType", "ServerlessCache")
	query.Set("X-Amz-Expires", strconv.FormatInt(int64(iamTokenLifetime/time.Second), 10))
	requestURL.RawQuery = query.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return AuthCredentials{}, err
	}
	signedURL, _, err := p.signer.PresignHTTP(ctx, credentials, request, emptyBodySHA256, elastiCacheServiceName, p.region, p.now().UTC())
	if err != nil {
		return AuthCredentials{}, err
	}
	return AuthCredentials{Username: p.userID, Password: strings.TrimPrefix(signedURL, "http://")}, nil
}
