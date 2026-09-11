# Mango transcription API setup

The independent transcription API and reusable browser dictation utilities remain after AI removal. The app has no mounted chat composer or microphone UI for them.

The API uses an injected `DEEPGRAM_API_KEY`, or resolves the explicitly configured `DEEPGRAM_API_KEY_SECRET_ARN` at startup with the existing AWS SDK credentials and profile. The secret must contain the raw Deepgram key in `SecretString`. Restart the backend after changing either setting. No frontend key or plaintext local key file is used. Missing configuration or a failed secret read leaves the rest of the API available and returns `503 transcription_unavailable` for transcription; startup logs show only sanitized configuration guidance.

For local development, sign in and pass only the authorized ARN before starting the backend with its normal local configuration:

```powershell
aws sso login --profile mangorts-dev
$env:AWS_PROFILE = "mangorts-dev"
$env:DEEPGRAM_API_KEY_SECRET_ARN = "arn:aws:secretsmanager:us-west-1:686458136219:secret:mangorts/dev/default-deepgram-api-key-IqG08B"
```

The runtime uses the ARN's region and requires `secretsmanager:GetSecretValue` for that exact secret. This does not change IAM or retrieve any other secret. The existing local launcher inherits these environment settings; it does not need to retrieve or write the Deepgram value itself.

Dev deployment accepts the optional GitHub repository variable `TF_DEEPGRAM_API_KEY_SECRET_ARN`, or `deepgram_api_key_secret_arn` in the existing dev Terraform configuration. The value is the ARN of an existing secret containing the raw Deepgram key. ECS injects that secret as `DEEPGRAM_API_KEY`; an empty ARN disables deployed dictation. Non-dev deployment does not accept this setting. These source changes do not create a secret or deploy anything.

`POST /v1/transcriptions?company_id=...` accepts authenticated raw WebM, Ogg, or MP4 audio. It streams progress followed by the transcript or a sanitized error as newline-delimited JSON. The reusable frontend client uses the existing `requestJSON` authentication and response-consumption support. The service requires no agent runtime.

The provider request fixes `model=nova-3`, `language=en`, and `smart_format=true`. Audio stays in browser memory until upload and is streamed through Mango to Deepgram without durable Mango storage. A response-header deadline allows ten minutes of provider processing after upload; progress every fifteen seconds keeps the HTTP response active. This follows Deepgram's documented prerecorded audio size and processing limits. [Deepgram prerecorded audio](https://developers.deepgram.com/docs/pre-recorded-audio).

Microphone access requires HTTPS or localhost and a supported browser. Permission/startup waits at most thirty seconds, and recorder finalization waits at most five seconds. Animation measures microphone sound, so background noise can activate the waves and reset the silence timer. The behavior contract is [STT.md](../tests/STT.md).

Transcription tests cover the service and reusable browser utilities. No live microphone or provider check is implied by removing the chat UI. No secret or deployment change is required by that source removal.
