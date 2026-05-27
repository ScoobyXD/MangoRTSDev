package main

import (
	"bufio"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"miraeopus/backend/internal/auth"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	httpapi "miraeopus/backend/internal/http"
	"miraeopus/backend/internal/store"
)

func main() {
	repo, workspaceFanout, cleanup := buildRepository()
	defer cleanup()
	server := httpapi.NewServerWithOptions(repo, httpapi.ServerOptions{
		AuthValidator: buildAuthValidator(),
		CognitoAdmin:  buildCognitoAdminClient(),
		EmailSender:   buildEmailSender(),
		AppBaseURL:    strings.TrimSpace(os.Getenv("MANGORTS_APP_URL")),
		BootstrapDevAdmin: httpapi.BootstrapDevAdminConfig{
			Emails:      splitScopes(os.Getenv("MANGORTS_BOOTSTRAP_DEV_ADMIN_EMAILS")),
			CompanyName: getenvDefault("MANGORTS_BOOTSTRAP_DEV_COMPANY_NAME", "MangoRTS Bootstrap"),
		},
		NylasClient:          buildNylasClient(),
		NylasConfig:          buildNylasConfig(),
		WorkspaceEventFanout: workspaceFanout,
	})
	defer server.Close()

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

func buildRepository() (store.Repository, store.WorkspaceEventFanout, func()) {
	host := os.Getenv("DB_HOST")
	allowFallback := strings.EqualFold(os.Getenv("ALLOW_INMEMORY_FALLBACK"), "true")
	appEnv := getenvDefault("APP_ENV", "dev")

	if host == "" {
		if appEnv == "dev" || allowFallback {
			log.Println("using in-memory repository (DB_HOST not set, dev/fallback mode)")
			return store.NewMemoryRepo(), nil, func() {}
		}
		log.Fatal("DB_HOST is required when APP_ENV is not dev")
	}

	port := getenvDefault("DB_PORT", "5432")
	user := getenvDefault("DB_USER", "postgres")
	password := os.Getenv("DB_PASSWORD")
	dbName := getenvDefault("DB_NAME", "postgres")
	sslMode := getenvDefault("DB_SSLMODE", "require")
	connectTimeoutSeconds := envIntDefault("DB_CONNECT_TIMEOUT_SECONDS", 5)

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s connect_timeout=%d", host, port, user, password, dbName, sslMode, connectTimeoutSeconds)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		if appEnv == "dev" || allowFallback {
			log.Printf("failed to open postgres (%v), falling back to in-memory repository", err)
			return store.NewMemoryRepo(), nil, func() {}
		}
		log.Fatalf("failed to open postgres in %s: %v", appEnv, err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		if appEnv == "dev" || allowFallback {
			log.Printf("failed to connect postgres (%v), falling back to in-memory repository", err)
			return store.NewMemoryRepo(), nil, func() {}
		}
		log.Fatalf("failed to connect postgres in %s: %v", appEnv, err)
	}
	configureDatabasePool(db)

	log.Printf("using postgres repository host=%s db=%s sslmode=%s", host, dbName, sslMode)
	return store.NewPostgresRepo(db), store.NewPostgresWorkspaceEventFanout(db, dsn), func() { _ = db.Close() }
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

func buildNylasClient() httpapi.NylasClient {
	config := buildNylasConfig()
	if !config.IsConfigured() {
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
			w.Header().Add("Vary", "Origin")
		}
		// Keep CORS allow-list aligned with hot-path API verbs used by frontend modules.
		// Node title updates use PUT and require successful preflight to avoid browser fetch failures.
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization,Cache-Control,If-None-Match,Last-Event-ID")
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
	if allowedOrigin == "*" {
		return "*"
	}
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return ""
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
