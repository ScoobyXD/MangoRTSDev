package main

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	httpapi "miraeopus/backend/internal/http"
	"miraeopus/backend/internal/store"
)

func main() {
	repo, cleanup := buildRepository()
	defer cleanup()
	server := httpapi.NewServer(repo)

	addr := os.Getenv("MIRAEOPUS_ADDR")
	if addr == "" {
		addr = ":8080"
	}

	httpServer := &http.Server{
		Addr:              addr,
		Handler:           withLogging(server.Routes()),
		ReadHeaderTimeout: 5 * time.Second,
	}

	log.Printf("miraeopus-api listening on %s", addr)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func buildRepository() (store.Repository, func()) {
	host := os.Getenv("DB_HOST")
	if host == "" {
		log.Println("using in-memory repository (DB_HOST not set)")
		return store.NewMemoryRepo(), func() {}
	}

	port := getenvDefault("DB_PORT", "5432")
	user := getenvDefault("DB_USER", "postgres")
	password := os.Getenv("DB_PASSWORD")
	dbName := getenvDefault("DB_NAME", "postgres")
	sslMode := getenvDefault("DB_SSLMODE", "require")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s", host, port, user, password, dbName, sslMode)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("failed to open postgres (%v), falling back to in-memory repository", err)
		return store.NewMemoryRepo(), func() {}
	}
	if err := db.Ping(); err != nil {
		log.Printf("failed to connect postgres (%v), falling back to in-memory repository", err)
		_ = db.Close()
		return store.NewMemoryRepo(), func() {}
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

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start))
	})
}
