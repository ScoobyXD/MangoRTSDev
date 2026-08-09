package main

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"miraeopus/backend/internal/auth"
	"miraeopus/backend/internal/emailqueue"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	_ "github.com/jackc/pgx/v5/stdlib"
	httpapi "miraeopus/backend/internal/http"
	"miraeopus/backend/internal/realtime"
	"miraeopus/backend/internal/store"
)

func main() {
	runtimeRole := strings.ToLower(strings.TrimSpace(getenvDefault("MANGORTS_RUNTIME_ROLE", "api")))
	if runtimeRole != "api" && runtimeRole != "email-worker" {
		log.Fatal("MANGORTS_RUNTIME_ROLE must be api or email-worker")
	}
	if runtimeRole == "email-worker" && strings.TrimSpace(os.Getenv("DB_HOST")) == "" {
		log.Fatal("DB_HOST is required for the email worker")
	}
	repo, cleanup, err := buildRepository()
	if err != nil {
		log.Fatal(err)
	}
	defer cleanup()
	nylasConfig := buildNylasConfig()
	var authValidator httpapi.AuthTokenValidator
	if validator := buildAuthValidator(); validator != nil {
		authValidator = validator
	}
	var cognitoAdmin httpapi.CognitoAdminClient
	if client := buildCognitoAdminClient(); client != nil {
		cognitoAdmin = client
	}
	var emailSender httpapi.AuthEmailSender
	if sender := buildEmailSender(); sender != nil {
		emailSender = sender
	}
	testAuthHeaderEnabled := strings.EqualFold(os.Getenv("APP_ENV"), "test") && strings.EqualFold(os.Getenv("MANGORTS_ENABLE_TEST_AUTH_HEADER"), "true")
	if testAuthHeaderEnabled {
		log.Print("test-only authentication header enabled")
	}
	emailSQS, err := buildEmailQueue()
	if err != nil {
		log.Fatal(err)
	}
	if runtimeRole == "email-worker" && emailSQS == nil {
		log.Fatal("MANGORTS_EMAIL_WORK_QUEUE_URL is required for the email worker")
	}
	nylasClient := buildNylasClient(nylasConfig)
	if runtimeRole == "email-worker" && nylasClient == nil {
		log.Fatal("NYLAS_CLIENT_ID, NYLAS_API_KEY, and NYLAS_API_BASE_URL are required for the email worker")
	}
	realtimeBackplane, externalRealtime, err := buildRealtimeBackplane(runtimeRole == "email-worker")
	if err != nil {
		log.Fatal(err)
	}
	server := httpapi.NewServerWithOptions(repo, httpapi.ServerOptions{
		AuthValidator:         authValidator,
		TestAuthHeaderEnabled: testAuthHeaderEnabled,
		CognitoAdmin:          cognitoAdmin,
		EmailSender:           emailSender,
		AppBaseURL:            strings.TrimSpace(os.Getenv("MANGORTS_APP_URL")),
		BootstrapDevAdmin: httpapi.BootstrapDevAdminConfig{
			Emails:      splitScopes(os.Getenv("MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS")),
			CompanyName: getenvDefault("MANGORTS_BOOTSTRAP_DEV_COMPANY_NAME", "MangoRTS Bootstrap"),
		},
		NylasClient:                 nylasClient,
		NylasConfig:                 nylasConfig,
		AttachmentStorage:           httpapi.NewS3AttachmentStorageFromEnv(),
		RealtimeTicketSecret:        secretEnvValue("MANGORTS_REALTIME_TICKET_SECRET", "realtime_ticket_secret", "ticket_secret", "MANGORTS_REALTIME_TICKET_SECRET"),
		RealtimeBackplane:           realtimeBackplane,
		EmailQueue:                  emailSQS,
		EmailWorkerOnly:             runtimeRole == "email-worker",
		EmailWorkerExternalRealtime: runtimeRole == "email-worker" && externalRealtime,
	})
	defer server.Close()
	if runtimeRole == "email-worker" {
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		log.Printf("email worker started concurrency=%d", envIntDefault("MANGORTS_EMAIL_WORKER_CONCURRENCY", 3))
		err := server.RunEmailWorker(ctx, emailSQS, envIntDefault("MANGORTS_EMAIL_WORKER_CONCURRENCY", 3))
		if err != nil && !errors.Is(err, context.Canceled) {
			log.Fatal(err)
		}
		return
	}

	addr := os.Getenv("MANGORTS_ADDR")
	if addr == "" {
		addr = os.Getenv("MIRAEOPUS_ADDR")
	}
	if addr == "" {
		addr = ":8080"
	}

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           withSecurityHeaders(withLogging(withCORS(server.Routes()))),
		ReadHeaderTimeout: envDurationDefault("HTTP_READ_HEADER_TIMEOUT", 5*time.Second),
		ReadTimeout:       envDurationDefault("HTTP_READ_TIMEOUT", 15*time.Second),
		IdleTimeout:       envDurationDefault("HTTP_IDLE_TIMEOUT", 60*time.Second),
		MaxHeaderBytes:    envIntDefault("HTTP_MAX_HEADER_BYTES", 1<<20),
	}

	log.Printf("miraeopus-api listening on %s", addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func buildEmailQueue() (*emailqueue.SQS, error) {
	queueURL := strings.TrimSpace(os.Getenv("MANGORTS_EMAIL_WORK_QUEUE_URL"))
	if queueURL == "" {
		return nil, nil
	}
	region := getenvDefault("AWS_REGION", getenvDefault("AWS_DEFAULT_REGION", ""))
	if region == "" {
		return nil, fmt.Errorf("AWS_REGION is required when MANGORTS_EMAIL_WORK_QUEUE_URL is set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	config, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, fmt.Errorf("load AWS config for email SQS: %w", err)
	}
	return emailqueue.NewSQS(sqs.NewFromConfig(config), queueURL)
}

func buildRealtimeBackplane(requireExternal bool) (realtime.Backplane, bool, error) {
	config, useLocal, err := realtimeBackplaneEnvironmentFromLookup(os.Getenv)
	if err != nil {
		return nil, false, err
	}
	if useLocal {
		if requireExternal {
			return nil, false, errors.New("complete external Valkey configuration is required for the email worker")
		}
		log.Print("using process-local realtime backplane (MANGORTS_VALKEY_ENDPOINT not set)")
		return realtime.NewLocalBackplane(), false, nil
	}
	// This is deliberate top-level application initialization. Credential
	// retrieval itself remains lazy and uses the ECS task role in dev.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	awsConfig, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(config.Region))
	if err != nil {
		return nil, false, fmt.Errorf("load AWS config for Valkey IAM authentication: %w", err)
	}
	authProvider, err := realtime.NewIAMAuthProvider(config.CacheName, config.UserID, config.Region, awsConfig.Credentials)
	if err != nil {
		return nil, false, fmt.Errorf("configure Valkey IAM authentication: %w", err)
	}
	backplane, err := realtime.NewValkeyBackplane(realtime.ValkeyConfig{
		Endpoint: config.Endpoint, Channel: config.Channel, Auth: authProvider,
	})
	if err != nil {
		return nil, false, fmt.Errorf("configure Valkey realtime backplane: %w", err)
	}
	log.Printf("using TLS/IAM Valkey realtime backplane cache=%s region=%s", config.CacheName, config.Region)
	return backplane, true, nil
}

type realtimeBackplaneEnvironment struct {
	Endpoint  string
	Region    string
	CacheName string
	UserID    string
	Channel   string
}

func realtimeBackplaneEnvironmentFromLookup(getenv func(string) string) (realtimeBackplaneEnvironment, bool, error) {
	trimmed := func(key string) string { return strings.TrimSpace(getenv(key)) }
	required := false
	if raw := trimmed("MANGORTS_VALKEY_REQUIRED"); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			return realtimeBackplaneEnvironment{}, false, fmt.Errorf("MANGORTS_VALKEY_REQUIRED must be true or false")
		}
		required = parsed
	}
	config := realtimeBackplaneEnvironment{
		Endpoint:  trimmed("MANGORTS_VALKEY_ENDPOINT"),
		Region:    trimmed("MANGORTS_VALKEY_REGION"),
		CacheName: trimmed("MANGORTS_VALKEY_CACHE_NAME"),
		UserID:    trimmed("MANGORTS_VALKEY_USER_ID"),
		Channel:   trimmed("MANGORTS_VALKEY_CHANNEL"),
	}
	if config.Region == "" {
		config.Region = trimmed("AWS_REGION")
	}
	if config.Region == "" {
		config.Region = trimmed("AWS_DEFAULT_REGION")
	}
	anyValkeyConfig := config.Endpoint != "" || trimmed("MANGORTS_VALKEY_REGION") != "" || config.CacheName != "" || config.UserID != "" || config.Channel != ""
	if !anyValkeyConfig && !required {
		return realtimeBackplaneEnvironment{}, true, nil
	}
	if config.Endpoint == "" || config.Region == "" || config.CacheName == "" || config.UserID == "" || config.Channel == "" {
		return realtimeBackplaneEnvironment{}, false, fmt.Errorf("Valkey realtime is required or partially configured; set MANGORTS_VALKEY_ENDPOINT, MANGORTS_VALKEY_REGION (or AWS_REGION), MANGORTS_VALKEY_CACHE_NAME, MANGORTS_VALKEY_USER_ID, and MANGORTS_VALKEY_CHANNEL")
	}
	return config, false, nil
}

type repositoryStartupConfig struct {
	Host                  string
	Port                  string
	User                  string
	Password              string
	DatabaseName          string
	SSLMode               string
	ConnectTimeoutSeconds int
}

type repositoryOpenFunc func(repositoryStartupConfig) (store.Repository, func(), error)

func buildRepository() (store.Repository, func(), error) {
	return buildRepositoryFromEnvironment(os.Getenv, openPostgresRepository)
}

func buildRepositoryFromEnvironment(getenv func(string) string, openPostgres repositoryOpenFunc) (store.Repository, func(), error) {
	trimmed := func(key string) string { return strings.TrimSpace(getenv(key)) }
	defaulted := func(key, fallback string) string {
		if value := trimmed(key); value != "" {
			return value
		}
		return fallback
	}
	host := trimmed("DB_HOST")
	allowMemory := strings.EqualFold(trimmed("ALLOW_INMEMORY_FALLBACK"), "true")
	if host == "" {
		if !allowMemory {
			return nil, nil, fmt.Errorf("DB_HOST is required unless ALLOW_INMEMORY_FALLBACK=true explicitly selects local in-memory mode")
		}
		log.Print("using explicitly allowed in-memory repository (DB_HOST not set)")
		return store.NewMemoryRepo(), func() {}, nil
	}
	config := repositoryStartupConfig{
		Host: host, Port: defaulted("DB_PORT", "5432"), User: defaulted("DB_USER", "postgres"),
		Password: getenv("DB_PASSWORD"), DatabaseName: defaulted("DB_NAME", "postgres"),
		SSLMode: defaulted("DB_SSLMODE", "require"), ConnectTimeoutSeconds: 5,
	}
	if raw := trimmed("DB_CONNECT_TIMEOUT_SECONDS"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value <= 0 {
			return nil, nil, fmt.Errorf("DB_CONNECT_TIMEOUT_SECONDS must be a positive integer")
		}
		config.ConnectTimeoutSeconds = value
	}
	return openPostgres(config)
}

func openPostgresRepository(config repositoryStartupConfig) (store.Repository, func(), error) {
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s connect_timeout=%d", config.Host, config.Port, config.User, config.Password, config.DatabaseName, config.SSLMode, config.ConnectTimeoutSeconds)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, nil, fmt.Errorf("open PostgreSQL: %w", err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("connect PostgreSQL: %w", err)
	}
	configureDatabasePool(db)
	repo := store.NewPostgresRepo(db)
	if err := repo.CheckApplicationSchemaReadiness(); err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("PostgreSQL application schema is not ready: %w", err)
	}

	log.Printf("using postgres repository host=%s db=%s sslmode=%s", config.Host, config.DatabaseName, config.SSLMode)
	return repo, func() { _ = db.Close() }, nil
}

func getenvDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}

func envIntDefault(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		log.Printf("invalid %s=%q, using %d", key, raw, fallback)
		return fallback
	}
	return value
}

func envDurationDefault(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err != nil || value <= 0 {
		log.Printf("invalid %s=%q, using %s", key, raw, fallback)
		return fallback
	}
	return value
}

func configureDatabasePool(db *sql.DB) {
	maxOpen := envIntDefault("DB_MAX_OPEN_CONNS", 20)
	maxIdle := envIntDefault("DB_MAX_IDLE_CONNS", 10)
	if maxIdle > maxOpen {
		maxIdle = maxOpen
	}
	connMaxLifetime := envDurationDefault("DB_CONN_MAX_LIFETIME", 30*time.Minute)
	connMaxIdleTime := envDurationDefault("DB_CONN_MAX_IDLE_TIME", 5*time.Minute)

	db.SetMaxOpenConns(maxOpen)
	db.SetMaxIdleConns(maxIdle)
	db.SetConnMaxLifetime(connMaxLifetime)
	db.SetConnMaxIdleTime(connMaxIdleTime)
	log.Printf("postgres pool max_open=%d max_idle=%d conn_max_lifetime=%s conn_max_idle_time=%s", maxOpen, maxIdle, connMaxLifetime, connMaxIdleTime)
}

func buildAuthValidator() *auth.Validator {
	if !strings.EqualFold(os.Getenv("AUTH_MODE"), "cognito") {
		return nil
	}
	region := getenvDefault("AWS_REGION", getenvDefault("AWS_DEFAULT_REGION", ""))
	userPoolID := os.Getenv("COGNITO_USER_POOL_ID")
	clientID := os.Getenv("COGNITO_CLIENT_ID")
	issuer := os.Getenv("COGNITO_ISSUER")
	if issuer == "" && region != "" && userPoolID != "" {
		issuer = fmt.Sprintf("https://cognito-idp.%s.amazonaws.com/%s", region, userPoolID)
	}
	jwksURL := os.Getenv("COGNITO_JWKS_URL")
	if jwksURL == "" && issuer != "" {
		jwksURL = strings.TrimRight(issuer, "/") + "/.well-known/jwks.json"
	}
	if issuer == "" || jwksURL == "" || clientID == "" {
		log.Fatal("AUTH_MODE=cognito requires COGNITO_CLIENT_ID and either COGNITO_ISSUER or AWS_REGION+COGNITO_USER_POOL_ID")
	}
	log.Printf("cognito auth enabled issuer=%s", issuer)
	return auth.NewValidator(auth.ValidatorConfig{
		Issuer:   issuer,
		ClientID: clientID,
		TokenUse: getenvDefault("COGNITO_TOKEN_USE", "access,id"),
	}, auth.NewRemoteJWKSource(jwksURL))
}

func buildCognitoAdminClient() *auth.CognitoAdminClient {
	if !strings.EqualFold(os.Getenv("AUTH_MODE"), "cognito") {
		return nil
	}
	region := getenvDefault("AWS_REGION", getenvDefault("AWS_DEFAULT_REGION", ""))
	userPoolID := os.Getenv("COGNITO_USER_POOL_ID")
	if region == "" || userPoolID == "" {
		return nil
	}
	return auth.NewCognitoAdminClient(region, userPoolID)
}

func buildEmailSender() *auth.SESEmailSender {
	if !strings.EqualFold(os.Getenv("AUTH_MODE"), "cognito") {
		return nil
	}
	from := strings.TrimSpace(os.Getenv("MANGORTS_EMAIL_FROM"))
	if from == "" {
		return nil
	}
	region := getenvDefault("AWS_REGION", getenvDefault("AWS_DEFAULT_REGION", ""))
	if region == "" {
		return nil
	}
	return auth.NewSESEmailSender(region, from)
}

func buildNylasConfig() httpapi.NylasConfig {
	return httpapi.NylasConfig{
		ClientID:            strings.TrimSpace(os.Getenv("NYLAS_CLIENT_ID")),
		APIKey:              secretEnvValue("NYLAS_API_KEY", "api_key", "nylas_api_key", "NYLAS_API_KEY"),
		APIBaseURL:          getenvDefault("NYLAS_API_BASE_URL", "https://api.us.nylas.com"),
		RedirectURI:         strings.TrimSpace(os.Getenv("NYLAS_REDIRECT_URI")),
		FrontendRedirectURL: strings.TrimSpace(os.Getenv("NYLAS_FRONTEND_REDIRECT_URL")),
		StateSecret:         secretEnvValue("NYLAS_STATE_SECRET", "state_secret", "nylas_state_secret", "NYLAS_STATE_SECRET"),
		WebhookSecret:       secretEnvValue("NYLAS_WEBHOOK_SECRET", "webhook_secret", "nylas_webhook_secret", "NYLAS_WEBHOOK_SECRET"),
		GoogleScopes:        splitScopes(os.Getenv("NYLAS_GOOGLE_SCOPES")),
		MicrosoftScopes:     splitScopes(os.Getenv("NYLAS_MICROSOFT_SCOPES")),
	}
}

func secretEnvValue(name string, propertyNames ...string) string {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return ""
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return raw
	}
	for _, propertyName := range propertyNames {
		if value, ok := payload[propertyName]; ok {
			if text := strings.TrimSpace(fmt.Sprint(value)); text != "" {
				return text
			}
		}
	}
	return raw
}

func buildNylasClient(config httpapi.NylasConfig) httpapi.NylasClient {
	if strings.TrimSpace(config.ClientID) == "" || strings.TrimSpace(config.APIKey) == "" || strings.TrimSpace(config.APIBaseURL) == "" {
		return nil
	}
	return httpapi.NewNylasRESTClient(config.APIBaseURL, config.APIKey, config.ClientID)
}

func splitScopes(raw string) []string {
	fields := strings.Fields(strings.ReplaceAll(raw, ",", " "))
	if len(fields) == 0 {
		return nil
	}
	return fields
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &loggingResponseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		if shouldLogRequest(r, rec.status) {
			log.Printf("%s %s status=%d bytes=%d duration=%s", r.Method, r.URL.Path, rec.status, rec.bytes, time.Since(start))
		}
	})
}

func shouldLogRequest(r *http.Request, status int) bool {
	if r.Method == http.MethodPost && r.URL.Path == "/nylas/webhook" && status < http.StatusBadRequest {
		return envBoolDefault("LOG_SUCCESSFUL_NYLAS_WEBHOOKS", false)
	}
	return true
}

func envBoolDefault(key string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	switch strings.ToLower(raw) {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

type loggingResponseWriter struct {
	http.ResponseWriter
	status      int
	bytes       int
	wroteHeader bool
}

func (w *loggingResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.status = status
	w.wroteHeader = true
	w.ResponseWriter.WriteHeader(status)
}

func (w *loggingResponseWriter) Write(body []byte) (int, error) {
	if !w.wroteHeader {
		w.wroteHeader = true
	}
	n, err := w.ResponseWriter.Write(body)
	w.bytes += n
	return n, err
}

func (w *loggingResponseWriter) Flush() {
	if flusher, ok := w.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (w *loggingResponseWriter) Unwrap() http.ResponseWriter {
	return w.ResponseWriter
}

func (w *loggingResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hijacker, ok := w.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, http.ErrNotSupported
	}
	return hijacker.Hijack()
}

func withCORS(next http.Handler) http.Handler {
	allowedOrigin := os.Getenv("MANGORTS_ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = getenvDefault("MIRAEOPUS_ALLOWED_ORIGIN", "*")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := corsAllowedOrigin(r.Header.Get("Origin"), allowedOrigin); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		// Keep CORS allow-list aligned with hot-path API verbs and headers used by frontend modules.
		// V2 policy writes use If-Match for stale-write protection.
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,Cache-Control,If-Match,If-None-Match,Idempotency-Key,Last-Event-ID,X-Idempotency-Key,X-Mango-Confirmation-Display-Name,X-Mango-Company-ID,X-Mango-Test-Subject")
		w.Header().Set("Access-Control-Expose-Headers", "ETag")
		w.Header().Set("Access-Control-Max-Age", "600")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func corsAllowedOrigin(origin, allowedOrigin string) string {
	allowedOrigin = strings.TrimSpace(allowedOrigin)
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return ""
	}
	if allowedOrigin == "*" {
		return origin
	}
	for _, candidate := range strings.Split(allowedOrigin, ",") {
		if strings.TrimSpace(candidate) == origin {
			return origin
		}
	}
	return ""
}

func withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}
