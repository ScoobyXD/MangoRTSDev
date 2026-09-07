package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/aws/arn"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

type runtimeSecretClient interface {
	GetSecretValue(context.Context, *secretsmanager.GetSecretValueInput, ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error)
}

// Injected ECS secrets already live in the process environment. Local runtimes
// can instead resolve one explicitly configured ARN with their AWS SSO profile.
func loadRuntimeSecret(ctx context.Context, envName, arnEnv string) (string, error) {
	if value := strings.TrimSpace(os.Getenv(envName)); value != "" {
		return value, nil
	}
	secretARN := strings.TrimSpace(os.Getenv(arnEnv))
	if secretARN == "" {
		return "", nil
	}
	parsed, err := arn.Parse(secretARN)
	if err != nil || parsed.Service != "secretsmanager" || parsed.Region == "" || parsed.AccountID == "" || !strings.HasPrefix(parsed.Resource, "secret:") || strings.TrimPrefix(parsed.Resource, "secret:") == "" || strings.ContainsAny(secretARN, "*?\r\n") {
		return "", fmt.Errorf("%s must be a Secrets Manager secret ARN", arnEnv)
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	config, err := awsconfig.LoadDefaultConfig(ctx, awsconfig.WithRegion(parsed.Region))
	if err != nil {
		return "", fmt.Errorf("%s: AWS configuration is unavailable; check AWS_PROFILE", arnEnv)
	}
	value, err := readRuntimeSecret(ctx, secretsmanager.NewFromConfig(config), secretARN)
	if err != nil {
		return "", fmt.Errorf("%s: %s", arnEnv, err)
	}
	return value, nil
}

func readRuntimeSecret(ctx context.Context, client runtimeSecretClient, secretARN string) (string, error) {
	result, err := client.GetSecretValue(ctx, &secretsmanager.GetSecretValueInput{SecretId: aws.String(secretARN)})
	if err != nil {
		// SDK/provider errors may contain request or credential details. Never log
		// them or secret payloads; startup logs only this configuration guidance.
		return "", errors.New("secret read failed; check AWS SSO and secretsmanager:GetSecretValue access")
	}
	if result == nil || result.SecretString == nil || strings.TrimSpace(*result.SecretString) == "" {
		return "", errors.New("secret must contain a nonempty SecretString")
	}
	return strings.TrimSpace(*result.SecretString), nil
}
