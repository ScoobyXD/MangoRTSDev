package main

import (
	"database/sql"
	"fmt"
	"log"
	"miraeopus/backend/internal/auth"
	"net/http"
	"os"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	httpapi "miraeopus/backend/internal/http"
	"miraeopus/backend/internal/store"
)

func main() {
	repo, cleanup := buildRepository()
	defer cleanup()
	server := httpapi.NewServerWithOptions(repo, httpapi.ServerOptions{
		AuthValidator: buildAuthValidator(),
		CognitoAdmin:  buildCognitoAdminClient(),
		EmailSender:   buildEmailSender(),
	})

	addr := os.Getenv("MANGORTS_ADDR")
	if addr == "" {
		addr = os.Getenv("MIRAEOPUS_ADDR")
	}
	if addr == "" {
		addr = ":8080"
	}

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           withLogging(withCORS(server.Routes())),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("miraeopus-api listening on %s", addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func buildRepository() (store.Repository, func()) {
	host := os.Getenv("DB_HOST")
	allowFallback := strings.EqualFold(os.Getenv("ALLOW_INMEMORY_FALLBACK"), "true")
	appEnv := getenvDefault("APP_ENV", "dev")

	if host == "" {
		if appEnv == "dev" || allowFallback {
			log.Println("using in-memory repository (DB_HOST not set, dev/fallback mode)")
			return store.NewMemoryRepo(), func() {}
		}
		log.Fatal("DB_HOST is required when APP_ENV is not dev")
	}

	port := getenvDefault("DB_PORT", "5432")
	user := getenvDefault("DB_USER", "postgres")
	password := os.Getenv("DB_PASSWORD")
	dbName := getenvDefault("DB_NAME", "postgres")
	sslMode := getenvDefault("DB_SSLMODE", "require")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, user, password, dbName, sslMode)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		if appEnv == "dev" || allowFallback {
			log.Printf("failed to open postgres (%v), falling back to in-memory repository", err)
			return store.NewMemoryRepo(), func() {}
		}
		log.Fatalf("failed to open postgres in %s: %v", appEnv, err)
	}
	if err := db.Ping(); err != nil {
		_ = db.Close()
		if appEnv == "dev" || allowFallback {
			log.Printf("failed to connect postgres (%v), falling back to in-memory repository", err)
			return store.NewMemoryRepo(), func() {}
		}
		log.Fatalf("failed to connect postgres in %s: %v", appEnv, err)
	}

	log.Printf("using postgres repository host=%s db=%s sslmode=%s", host, dbName, sslMode)
	return store.NewPostgresRepo(db), func() { _ = db.Close() }
}

func getenvDefault(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
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

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start))
	})
}

func withCORS(next http.Handler) http.Handler {
	allowedOrigin := os.Getenv("MANGORTS_ALLOWED_ORIGIN")
	if allowedOrigin == "" {
		allowedOrigin = getenvDefault("MIRAEOPUS_ALLOWED_ORIGIN", "*")
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
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
