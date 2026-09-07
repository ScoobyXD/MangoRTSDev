package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

func TestRuntimeSecretInjectedOrMissingDoesNotNeedAWS(t *testing.T) {
	t.Setenv("AWS_PROFILE", "no-such-runtime-secret-test-profile")
	t.Setenv("DEEPGRAM_API_KEY_SECRET_ARN", "")
	t.Setenv("DEEPGRAM_API_KEY", "")
	value, err := loadRuntimeSecret(context.Background(), "DEEPGRAM_API_KEY", "DEEPGRAM_API_KEY_SECRET_ARN")
	if err != nil || value != "" {
		t.Fatal("missing optional configuration must leave transcription unavailable without AWS access")
	}
	t.Setenv("DEEPGRAM_API_KEY", "  injected-fixture-key  ")
	t.Setenv("DEEPGRAM_API_KEY_SECRET_ARN", "unused-reference")
	value, err = loadRuntimeSecret(context.Background(), "DEEPGRAM_API_KEY", "DEEPGRAM_API_KEY_SECRET_ARN")
	if err != nil || value != "injected-fixture-key" {
		t.Fatal("injected secret must be used without AWS access")
	}
}

func TestRuntimeSecretRejectsNonSecretReferences(t *testing.T) {
	t.Setenv("DEEPGRAM_API_KEY", "")
	for _, reference := range []string{"secret-name", "arn:aws:s3:us-west-1:123456789012:secret:key", "arn:aws:secretsmanager::123456789012:secret:key", "arn:aws:secretsmanager:us-west-1::secret:key", "arn:aws:secretsmanager:us-west-1:123456789012:secret:", "arn:aws:secretsmanager:us-west-1:123456789012:secret:*"} {
		t.Setenv("DEEPGRAM_API_KEY_SECRET_ARN", reference)
		value, err := loadRuntimeSecret(context.Background(), "DEEPGRAM_API_KEY", "DEEPGRAM_API_KEY_SECRET_ARN")
		if value != "" || err == nil || err.Error() != "DEEPGRAM_API_KEY_SECRET_ARN must be a Secrets Manager secret ARN" {
			t.Fatal("invalid ARN must fail before AWS access without echoing the input")
		}
	}
}

type runtimeSecretStub func(context.Context, *secretsmanager.GetSecretValueInput) (*secretsmanager.GetSecretValueOutput, error)

func (stub runtimeSecretStub) GetSecretValue(ctx context.Context, input *secretsmanager.GetSecretValueInput, _ ...func(*secretsmanager.Options)) (*secretsmanager.GetSecretValueOutput, error) {
	return stub(ctx, input)
}

func TestRuntimeSecretReadsOnlyConfiguredARN(t *testing.T) {
	const reference = "arn:aws:secretsmanager:us-west-1:123456789012:secret:fixture-AbCdEf"
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	calls := 0
	client := runtimeSecretStub(func(requestContext context.Context, input *secretsmanager.GetSecretValueInput) (*secretsmanager.GetSecretValueOutput, error) {
		calls++
		if requestContext != ctx || aws.ToString(input.SecretId) != reference || input.VersionId != nil || input.VersionStage != nil {
			t.Fatal("secret read must use exactly the configured ARN and caller context")
		}
		return &secretsmanager.GetSecretValueOutput{SecretString: aws.String(" fixture-key ")}, nil
	})
	value, err := readRuntimeSecret(ctx, client, reference)
	if err != nil || value != "fixture-key" || calls != 1 {
		t.Fatal("runtime must load the configured secret once")
	}
}

func TestRuntimeSecretFailuresNeverExposeProviderDetails(t *testing.T) {
	for _, scenario := range []struct {
		result *secretsmanager.GetSecretValueOutput
		err    error
	}{
		{err: errors.New("provider error containing private-fixture-value")},
		{},
		{result: &secretsmanager.GetSecretValueOutput{SecretBinary: []byte("private-fixture-value")}},
		{result: &secretsmanager.GetSecretValueOutput{SecretString: aws.String("  ")}},
	} {
		client := runtimeSecretStub(func(context.Context, *secretsmanager.GetSecretValueInput) (*secretsmanager.GetSecretValueOutput, error) {
			return scenario.result, scenario.err
		})
		value, err := readRuntimeSecret(context.Background(), client, "fixture-reference")
		if value != "" || err == nil || strings.Contains(err.Error(), "private-fixture-value") {
			t.Fatal("unavailable or invalid secrets must fail without exposing private provider details")
		}
	}
}
