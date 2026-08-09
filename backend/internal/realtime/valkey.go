package realtime

import (
	"context"
	"crypto/tls"
	"errors"
	"math/rand"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/valkey-io/valkey-go"
)

const (
	defaultDialTimeout = 3 * time.Second
	maxRetryDelay      = 30 * time.Second
)

type ValkeyConfig struct {
	Endpoint    string
	Channel     string
	Auth        AuthProvider
	DialTimeout time.Duration
	TLSConfig   *tls.Config
}

type ValkeyBackplane struct {
	mu           sync.Mutex
	client       valkey.Client
	clientOption valkey.ClientOption
	channel      string
	closed       bool
}

func NewValkeyBackplane(config ValkeyConfig) (*ValkeyBackplane, error) {
	endpoint := strings.TrimSpace(config.Endpoint)
	channel := strings.TrimSpace(config.Channel)
	if endpoint == "" || channel == "" || config.Auth == nil {
		return nil, errors.New("Valkey endpoint, channel, and IAM auth provider are required")
	}
	host, _, err := net.SplitHostPort(endpoint)
	if err != nil {
		return nil, errors.New("Valkey endpoint must include host and port")
	}
	tlsConfig := config.TLSConfig
	if tlsConfig == nil {
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12, ServerName: host}
	} else {
		tlsConfig = tlsConfig.Clone()
		if tlsConfig.MinVersion == 0 {
			tlsConfig.MinVersion = tls.VersionTLS12
		}
		if strings.TrimSpace(tlsConfig.ServerName) == "" {
			tlsConfig.ServerName = host
		}
	}
	dialTimeout := config.DialTimeout
	if dialTimeout <= 0 {
		dialTimeout = defaultDialTimeout
	}
	clientOption := valkey.ClientOption{
		InitAddress:      []string{endpoint},
		TLSConfig:        tlsConfig,
		Dialer:           net.Dialer{Timeout: dialTimeout, KeepAlive: 5 * time.Second},
		ConnWriteTimeout: 5 * time.Second,
		DisableCache:     true,
		ClientSetInfo:    valkey.DisableClientSetInfo,
		RetryDelay: func(attempts int, _ valkey.Completed, _ error) time.Duration {
			return retryDelayWithJitter(attempts, rand.Int63())
		},
		AuthCredentialsFn: func(_ valkey.AuthCredentialsContext) (valkey.AuthCredentials, error) {
			// A connection attempt is a deliberate top-level lifecycle. The Valkey
			// client API does not provide a context to this callback.
			ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
			defer cancel()
			credentials, err := config.Auth.Credentials(ctx)
			if err != nil {
				return valkey.AuthCredentials{}, err
			}
			return valkey.AuthCredentials{Username: credentials.Username, Password: credentials.Password}, nil
		},
	}
	// Client creation is deliberately lazy. A Valkey outage during API startup
	// must not stop HTTP from serving durable PostgreSQL saves. The subscriber
	// lifecycle retries this cluster-mode connection with bounded backoff.
	return &ValkeyBackplane{clientOption: clientOption, channel: channel}, nil
}

func (b *ValkeyBackplane) Publish(ctx context.Context, payload []byte) error {
	client, err := b.clientForUse(ctx)
	if err != nil {
		return err
	}
	return client.Do(ctx, client.B().Publish().Channel(b.channel).Message(string(payload)).Build()).Error()
}

func (b *ValkeyBackplane) Subscribe(ctx context.Context, onMessage func([]byte), onReady func()) error {
	if onMessage == nil {
		return errors.New("realtime subscriber handler is required")
	}
	client, err := b.clientForUse(ctx)
	if err != nil {
		return err
	}
	ctx = valkey.WithOnSubscriptionHook(ctx, func(subscription valkey.PubSubSubscription) {
		if subscription.Kind == "subscribe" && subscription.Channel == b.channel && onReady != nil {
			onReady()
		}
	})
	return client.Receive(ctx, client.B().Subscribe().Channel(b.channel).Build(), func(message valkey.PubSubMessage) {
		if message.Channel == b.channel {
			onMessage([]byte(message.Message))
		}
	})
}

func (b *ValkeyBackplane) clientForUse(ctx context.Context) (valkey.Client, error) {
	if b == nil {
		return nil, ErrBackplaneClosed
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return nil, ErrBackplaneClosed
	}
	if b.client != nil {
		return b.client, nil
	}
	client, err := valkey.NewClient(b.clientOption)
	if err != nil {
		if client != nil {
			client.Close()
		}
		return nil, err
	}
	b.client = client
	return client, nil
}

func (b *ValkeyBackplane) Close() {
	if b == nil {
		return
	}
	b.mu.Lock()
	b.closed = true
	client := b.client
	b.client = nil
	b.mu.Unlock()
	if client != nil {
		client.Close()
	}
}

func retryDelayWithJitter(attempt int, random int64) time.Duration {
	if attempt < 0 {
		attempt = 0
	}
	base := 100 * time.Millisecond
	for i := 0; i < attempt && base < maxRetryDelay; i++ {
		base *= 2
		if base > maxRetryDelay {
			base = maxRetryDelay
		}
	}
	// Full jitter prevents all ECS tasks from reconnecting together.
	if base <= 0 {
		return 0
	}
	if random < 0 {
		random = -random
	}
	return time.Duration(random % int64(base+1))
}
