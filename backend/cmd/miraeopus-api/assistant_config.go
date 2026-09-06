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
	config := httpapi.AssistantConfig{APIKey: strings.TrimSpace(getenv("OPENAI_API_KEY")), Model: model}
	var err error
	if model != "" {
		config.APIKey, err = resolveAssistantAPIKey(ctx, getenv, newReader, "OPENAI_API_KEY", "Mango chat")
		if err != nil {
			return httpapi.AssistantConfig{}, err
		}
	}
	config.DeepgramAPIKey, err = resolveAssistantAPIKey(ctx, getenv, newReader, "DEEPGRAM_API_KEY", "Mango dictation")
	return config, err
}

func resolveAssistantAPIKey(ctx context.Context, getenv func(string) string, newReader assistantSecretReaderFactory, keyName, label string) (string, error) {
	if directKey := strings.TrimSpace(getenv(keyName)); directKey != "" {
		return directKey, nil
	}
	secretARN := strings.TrimSpace(getenv(keyName + "_SECRET_ARN"))
	if secretARN == "" {
		return "", nil
	}
	parsedARN, err := awsarn.Parse(secretARN)
	if err != nil || parsedARN.Service != "secretsmanager" || parsedARN.Region == "" {
		return "", fmt.Errorf("%s_SECRET_ARN must be a regional Secrets Manager ARN", keyName)
	}

	resolveCtx, cancel := context.WithTimeout(ctx, assistantSecretResolutionTimeout)
	defer cancel()
	reader, err := newReader(resolveCtx, parsedARN.Region)
	if err != nil {
		return "", fmt.Errorf("prepare Secrets Manager for %s: %w", label, err)
	}
	output, err := reader.GetSecretValue(resolveCtx, &secretsmanager.GetSecretValueInput{SecretId: aws.String(secretARN)})
	if err != nil {
		return "", fmt.Errorf("retrieve %s API key from Secrets Manager: %w", label, err)
	}
	if output == nil || output.SecretString == nil {
		return "", fmt.Errorf("%s secret must contain a nonempty SecretString", label)
	}
	return assistantAPIKeyFromSecret(*output.SecretString, keyName, label)
}

func newAssistantSecretReader(ctx context.Context, region string) (assistantSecretReader, error) {
	config, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(region))
	if err != nil {
		return nil, err
	}
	return secretsmanager.NewFromConfig(config), nil
}

func assistantAPIKeyFromSecret(raw, keyName, label string) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", fmt.Errorf("%s secret must contain a nonempty SecretString", label)
	}
	if !json.Valid([]byte(trimmed)) {
		return trimmed, nil
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return "", fmt.Errorf("%s JSON secret must be an object containing an API key", label)
	}
	for _, name := range []string{"api_key", keyName, strings.ToLower(keyName)} {
		if value, ok := payload[name].(string); ok {
			if text := strings.TrimSpace(value); text != "" {
				return text, nil
			}
		}
	}
	return "", fmt.Errorf("%s JSON secret must contain api_key, %s, or %s", label, keyName, strings.ToLower(keyName))
}
