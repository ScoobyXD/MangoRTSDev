package main

import (
	"log"
	"net/http"
	"os"
	"time"

	httpapi "miraeopus/backend/internal/http"
	"miraeopus/backend/internal/store"
)

func main() {
	repo := store.NewMemoryRepo()
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

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start))
	})
}
