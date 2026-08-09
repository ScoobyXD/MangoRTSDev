package main

import (
	"errors"
	"strings"
	"testing"

	"miraeopus/backend/internal/store"
)

func TestRepositoryStartupDeployedDevRequiresPostgres(t *testing.T) {
	openCalled := false
	_, _, err := buildRepositoryFromEnvironment(realtimeEnvironmentLookup(map[string]string{
		"APP_ENV":                 "dev",
		"ALLOW_INMEMORY_FALLBACK": "false",
	}), func(repositoryStartupConfig) (store.Repository, func(), error) {
		openCalled = true
		return store.NewMemoryRepo(), func() {}, nil
	})
	if err == nil || !strings.Contains(err.Error(), "DB_HOST is required") || openCalled {
		t.Fatalf("err=%v openCalled=%t; deployed DEV must fail before opening an absent database", err, openCalled)
	}
}

func TestRepositoryStartupAllowsOnlyExplicitNoDatabaseMemoryMode(t *testing.T) {
	openCalled := false
	repo, cleanup, err := buildRepositoryFromEnvironment(realtimeEnvironmentLookup(map[string]string{
		"APP_ENV":                 "dev",
		"ALLOW_INMEMORY_FALLBACK": "true",
	}), func(repositoryStartupConfig) (store.Repository, func(), error) {
		openCalled = true
		return nil, nil, errors.New("unexpected opener call")
	})
	if err != nil || repo == nil || cleanup == nil || openCalled {
		t.Fatalf("repo=%T cleanup=%v err=%v openCalled=%t", repo, cleanup != nil, err, openCalled)
	}
	cleanup()
}

func TestRepositoryStartupNeverFallsBackAfterPostgresIsConfigured(t *testing.T) {
	for name, startupErr := range map[string]error{
		"connection failure": errors.New("database unavailable"),
		"schema failure":     errors.New("schema not ready"),
	} {
		t.Run(name, func(t *testing.T) {
			openCalls := 0
			repo, cleanup, err := buildRepositoryFromEnvironment(realtimeEnvironmentLookup(map[string]string{
				"APP_ENV":                 "dev",
				"ALLOW_INMEMORY_FALLBACK": "true",
				"DB_HOST":                 "configured.database.internal",
			}), func(config repositoryStartupConfig) (store.Repository, func(), error) {
				openCalls++
				if config.Host != "configured.database.internal" {
					t.Fatalf("host=%q", config.Host)
				}
				return nil, nil, startupErr
			})
			if !errors.Is(err, startupErr) || repo != nil || cleanup != nil || openCalls != 1 {
				t.Fatalf("repo=%T cleanup=%v err=%v openCalls=%d", repo, cleanup != nil, err, openCalls)
			}
		})
	}
}

func TestRepositoryStartupRejectsInvalidConnectTimeout(t *testing.T) {
	openCalled := false
	_, _, err := buildRepositoryFromEnvironment(realtimeEnvironmentLookup(map[string]string{
		"DB_HOST":                    "configured.database.internal",
		"DB_CONNECT_TIMEOUT_SECONDS": "invalid",
	}), func(repositoryStartupConfig) (store.Repository, func(), error) {
		openCalled = true
		return store.NewMemoryRepo(), func() {}, nil
	})
	if err == nil || openCalled {
		t.Fatalf("err=%v openCalled=%t", err, openCalled)
	}
}
