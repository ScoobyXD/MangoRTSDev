package main

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/secretsmanager"
)

const testAssistantSecretARN = "arn:aws:secretsmanager:us-west-1:000000000000:secret:mangorts-test-openai"

type stubAssistantSecretReader struct {
	output *secretsmanager.GetSecretValueOutput
	err    error
	input  *secretsmanager.GetSecretValueInput
	calls  int
}

func (reader *stubAssistantSecretReader) GetSecretValue(
	_ context.Context,
	input *secretsmanager.GetSecretValueInput,
	_ ...func(*secretsmanager.Options),
) (*secretsmanager.GetSecretValueOutput, error) {
	reader.calls++
	reader.input = input
	return reader.output, reader.err
}

func assistantTestEnvironment(values map[string]string) func(string) string {
	return func(name string) string { return values[name] }
}

func TestBuildAssistantConfigPrefersDirectKeyWithoutAWS(t *testing.T) {
	factoryCalled := false
	config, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
		"OPENAI_API_KEY":            " direct-key ",
		"OPENAI_API_KEY_SECRET_ARN": "not-an-arn",
		"MANGORTS_ASSISTANT_MODEL":  " gpt-5.6-luna ",
	}), func(context.Context, string) (assistantSecretReader, error) {
		factoryCalled = true
		return nil, errors.New("must not be called")
	})
	if err != nil {
		t.Fatalf("build assistant config: %v", err)
	}
	if factoryCalled {
		t.Fatal("direct OPENAI_API_KEY must bypass Secrets Manager")
	}
	if config.APIKey != "direct-key" || config.Model != "gpt-5.6-luna" {
		t.Fatalf("unexpected config: %#v", config)
	}
}

func TestBuildAssistantConfigResolvesSecretARN(t *testing.T) {
	reader := &stubAssistantSecretReader{output: &secretsmanager.GetSecretValueOutput{SecretString: aws.String(`{"api_key":" resolved-key "}`)}}
	factoryCalls := 0
	config, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
		"OPENAI_API_KEY_SECRET_ARN": testAssistantSecretARN,
		"MANGORTS_ASSISTANT_MODEL":  "gpt-5.6-luna",
	}), func(_ context.Context, region string) (assistantSecretReader, error) {
		factoryCalls++
		if region != "us-west-1" {
			t.Fatalf("unexpected secret region: %q", region)
		}
		return reader, nil
	})
	if err != nil {
		t.Fatalf("build assistant config: %v", err)
	}
	if factoryCalls != 1 || reader.calls != 1 {
		t.Fatalf("expected one Secrets Manager read, factory=%d reader=%d", factoryCalls, reader.calls)
	}
	if reader.input == nil || aws.ToString(reader.input.SecretId) != testAssistantSecretARN {
		t.Fatalf("unexpected secret request: %#v", reader.input)
	}
	if config.APIKey != "resolved-key" || config.Model != "gpt-5.6-luna" {
		t.Fatalf("unexpected config: %#v", config)
	}
}

func TestBuildAssistantConfigLeavesIncompleteConfigurationUnavailable(t *testing.T) {
	tests := []map[string]string{
		{"MANGORTS_ASSISTANT_MODEL": "gpt-5.6-luna"},
		{"OPENAI_API_KEY_SECRET_ARN": testAssistantSecretARN},
	}
	for _, environment := range tests {
		factoryCalled := false
		config, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(environment), func(context.Context, string) (assistantSecretReader, error) {
			factoryCalled = true
			return nil, errors.New("must not be called")
		})
		if err != nil {
			t.Fatalf("build incomplete assistant config: %v", err)
		}
		if factoryCalled {
			t.Fatal("incomplete configuration must not call Secrets Manager")
		}
		if config.APIKey != "" {
			t.Fatalf("incomplete configuration returned a key: %#v", config)
		}
	}
}

func TestBuildAssistantConfigRejectsInvalidARNAndRetrievalFailure(t *testing.T) {
	_, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
		"OPENAI_API_KEY_SECRET_ARN": "not-an-arn",
		"MANGORTS_ASSISTANT_MODEL":  "gpt-5.6-luna",
	}), func(context.Context, string) (assistantSecretReader, error) {
		return nil, errors.New("must not be called")
	})
	if err == nil || !strings.Contains(err.Error(), "regional Secrets Manager ARN") {
		t.Fatalf("expected invalid ARN error, got %v", err)
	}

	providerError := errors.New("fixture retrieval failure")
	_, err = buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
		"OPENAI_API_KEY_SECRET_ARN": testAssistantSecretARN,
		"MANGORTS_ASSISTANT_MODEL":  "gpt-5.6-luna",
	}), func(context.Context, string) (assistantSecretReader, error) {
		return &stubAssistantSecretReader{err: providerError}, nil
	})
	if err == nil || !strings.Contains(err.Error(), "retrieve Mango chat API key") || !errors.Is(err, providerError) {
		t.Fatalf("expected wrapped retrieval error, got %v", err)
	}
}

func TestAssistantAPIKeyFromSecret(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		want    string
		wantErr bool
	}{
		{name: "plaintext", raw: "  plaintext-key  ", want: "plaintext-key"},
		{name: "JSON uppercase", raw: `{"OPENAI_API_KEY":"json-key"}`, want: "json-key"},
		{name: "empty", raw: "  ", wantErr: true},
		{name: "JSON missing key", raw: `{"unrelated":"value"}`, wantErr: true},
		{name: "JSON null key", raw: `{"api_key":null}`, wantErr: true},
		{name: "JSON numeric key", raw: `{"api_key":123}`, wantErr: true},
		{name: "JSON scalar", raw: `"quoted-key"`, wantErr: true},
		{name: "JSON array", raw: `["array-key"]`, wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := assistantAPIKeyFromSecret(test.raw, "OPENAI_API_KEY", "Mango chat")
			if test.wantErr {
				if err == nil {
					t.Fatalf("expected error, got key %q", got)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("assistantAPIKeyFromSecret() = %q, %v; want %q", got, err, test.want)
			}
		})
	}
}

func TestBuildAssistantConfigRejectsMissingSecretString(t *testing.T) {
	for _, output := range []*secretsmanager.GetSecretValueOutput{nil, {}, {SecretBinary: []byte("binary-key")}} {
		_, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
			"OPENAI_API_KEY_SECRET_ARN": testAssistantSecretARN,
			"MANGORTS_ASSISTANT_MODEL":  "gpt-5.6-luna",
		}), func(context.Context, string) (assistantSecretReader, error) {
			return &stubAssistantSecretReader{output: output}, nil
		})
		if err == nil || !strings.Contains(err.Error(), "nonempty SecretString") {
			t.Fatalf("expected SecretString error, got %v", err)
		}
	}
}

func TestBuildAssistantConfigDeepgramDirectKeyIsSeparateFromChat(t *testing.T) {
	config, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
		"DEEPGRAM_API_KEY":            " direct-deepgram-key ",
		"DEEPGRAM_API_KEY_SECRET_ARN": "must-not-be-read",
	}), func(context.Context, string) (assistantSecretReader, error) {
		t.Fatal("direct Deepgram key must not read AWS")
		return nil, nil
	})
	if err != nil || config.DeepgramAPIKey != "direct-deepgram-key" || config.APIKey != "" || config.Model != "" {
		t.Fatalf("incorrect dictation configuration: %#v, %v", config, err)
	}
}

func TestBuildAssistantConfigResolvesDeepgramSecret(t *testing.T) {
	const arn = "arn:aws:secretsmanager:us-west-1:000000000000:secret:mangorts-test-deepgram"
	for _, secret := range []string{"deepgram-key", `{"api_key":"deepgram-key"}`, `{"DEEPGRAM_API_KEY":"deepgram-key"}`, `{"deepgram_api_key":"deepgram-key"}`} {
		reader := &stubAssistantSecretReader{output: &secretsmanager.GetSecretValueOutput{SecretString: aws.String(secret)}}
		config, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
			"OPENAI_API_KEY":              "chat-key",
			"MANGORTS_ASSISTANT_MODEL":    "chat-model",
			"DEEPGRAM_API_KEY_SECRET_ARN": arn,
		}), func(ctx context.Context, region string) (assistantSecretReader, error) {
			if _, ok := ctx.Deadline(); !ok || region != "us-west-1" {
				t.Fatal("secret resolution must have a deadline and use the ARN region")
			}
			return reader, nil
		})
		if err != nil || config.DeepgramAPIKey != "deepgram-key" || config.APIKey != "chat-key" || config.Model != "chat-model" || reader.calls != 1 || aws.ToString(reader.input.SecretId) != arn {
			t.Fatalf("incorrect separate credential resolution: %#v, %v", config, err)
		}
	}
}

func TestBuildAssistantConfigRejectsDeepgramConfigurationFailure(t *testing.T) {
	for _, test := range []struct {
		name   string
		arn    string
		output *secretsmanager.GetSecretValueOutput
		err    error
	}{
		{name: "invalid ARN", arn: "not-an-arn"},
		{name: "provider error", arn: testAssistantSecretARN, err: errors.New("fixture unavailable")},
		{name: "missing string", arn: testAssistantSecretARN},
		{name: "wrong provider JSON", arn: testAssistantSecretARN, output: &secretsmanager.GetSecretValueOutput{SecretString: aws.String(`{"OPENAI_API_KEY":"chat-key"}`)}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := buildAssistantConfigFromEnvironment(context.Background(), assistantTestEnvironment(map[string]string{
				"DEEPGRAM_API_KEY_SECRET_ARN": test.arn,
			}), func(context.Context, string) (assistantSecretReader, error) {
				return &stubAssistantSecretReader{output: test.output, err: test.err}, nil
			})
			if err == nil || (!strings.Contains(err.Error(), "DEEPGRAM") && !strings.Contains(err.Error(), "Mango dictation")) {
				t.Fatalf("configured Deepgram failure must fail clearly: %v", err)
			}
		})
	}
}
