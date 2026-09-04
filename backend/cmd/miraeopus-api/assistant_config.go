package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsarn "github.com/aws/aws-sdk-go-v2/aws/arn"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
	httpapi "miraeopus/backend/internal/http"
)

const assistantSecretResolutionTimeout = 5 * time.Second

type assistantSecretReader interface {
	GetSecretValue(context.Context, *secretsmanager.GetSecretValueInput, ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error)
}

type assistantSecretReaderFactory func(context.Context, string) (assistantSecretReader, error)

func buildAssistantConfig(ctx context.Context) (httpapi.AssistantConfig, error) {
	return buildAssistantConfigFromEnvironment(ctx, os.Getenv, newAssistantSecretReader)
}

func buildAssistantConfigFromEnvironment(
	ctx context.Context,
	getenv func(string) string,
	newReader assistantSecretReaderFactory,
) (httpapi.AssistantConfig, error) {
	model := strings.TrimSpace(getenv("MANGORTS_ASSISTANT_MODEL"))
	directKey := strings.TrimSpace(getenv("OPENAI_API_KEY"))
	config := httpapi.AssistantConfig{APIKey: directKey, Model: model}
	if directKey != "" || model == "" {
		return config, nil
	}

	secretARN := strings.TrimSpace(getenv("OPENAI_API_KEY_SECRET_ARN"))
	if secretARN == "" {
		return config, nil
	}
	parsedARN, err := awsarn.Parse(secretARN)
	if err != nil || parsedARN.Service != "secretsmanager" || parsedARN.Region == "" {
		return httpapi.AssistantConfig{}, fmt.Errorf("OPENAI_API_KEY_SECRET_ARN must be a regional Secrets Manager ARN")
	}

	resolveCtx, cancel := context.WithTimeout(ctx, assistantSecretResolutionTimeout)
	defer cancel()
	reader, err := newReader(resolveCtx, parsedARN.Region)
	if err != nil {
		return httpapi.AssistantConfig{}, fmt.Errorf("prepare Secrets Manager for Mango chat: %w", err)
	}
	output, err := reader.GetSecretValue(resolveCtx, &secretsmanager.GetSecretValueInput{SecretId: aws.String(secretARN)})
	if err != nil {
		return httpapi.AssistantConfig{}, fmt.Errorf("retrieve Mango chat API key from Secrets Manager: %w", err)
	}
	if output == nil || output.SecretString == nil {
		return httpapi.AssistantConfig{}, fmt.Errorf("Mango chat secret must contain a nonempty SecretString")
	}
	apiKey, err := assistantAPIKeyFromSecret(*output.SecretString)
	if err != nil {
		return httpapi.AssistantConfig{}, err
	}
	return httpapi.AssistantConfig{APIKey: apiKey, Model: model}, nil
}

func newAssistantSecretReader(ctx context.Context, region string) (assistantSecretReader, error) {
	config, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return secretsmanager.NewFromConfig(config), nil
}

func assistantAPIKeyFromSecret(raw string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("Mango chat secret must contain a nonempty SecretString")
	}
	if !json.Valid([]byte(trimmed)) {
		return trimmed, nil
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return "", fmt.Errorf("Mango chat JSON secret must be an object containing an API key")
	}
	for _, name := range []string{"api_key", "OPENAI_API_KEY", "openai_api_key"} {
		if value, ok := payload[name].(string); ok {
			if text := strings.TrimSpace(value); text != "" {
				return text, nil
			}
		}
	}
	return "", fmt.Errorf("Mango chat JSON secret must contain api_key, OPENAI_API_KEY, or openai_api_key")
}
