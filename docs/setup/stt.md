# Mango dictation setup

The API reads `DEEPGRAM_API_KEY` from its server environment. Supply it securely before starting the backend; restart the backend after changing it. The local launcher inherits this variable. It does not retrieve a Deepgram secret from an ARN, and no frontend key is used. A missing key leaves typed drafts available and returns `503 transcription_unavailable` for transcription.

Dev deployment accepts the optional GitHub repository variable `TF_DEEPGRAM_API_KEY_SECRET_ARN`, or `deepgram_api_key_secret_arn` in the existing dev Terraform configuration. The value is the ARN of an existing secret containing the raw Deepgram key. ECS injects that secret as `DEEPGRAM_API_KEY`; an empty ARN disables deployed dictation. Non-dev deployment does not accept this setting. These source changes do not create a secret or deploy anything.

`POST /v1/transcriptions?company_id=...` accepts authenticated raw WebM, Ogg, or MP4 audio. It streams progress followed by the transcript or a sanitized error as newline-delimited JSON. The frontend uses the existing `requestJSON` authentication and response-consumption support. There is no assistant status request or agent dependency.

The provider request fixes `model=nova-3`, `language=en`, and `smart_format=true`. Audio stays in browser memory until upload and is streamed through Mango to Deepgram without durable Mango storage. A response-header deadline allows ten minutes of provider processing after upload; progress every fifteen seconds keeps the HTTP response active. This follows Deepgram's documented prerecorded audio size and processing limits. [Deepgram prerecorded audio](https://developers.deepgram.com/docs/pre-recorded-audio).

Microphone access requires HTTPS or localhost and a supported browser. Permission/startup waits at most thirty seconds, and recorder finalization waits at most five seconds. Animation measures microphone sound, so background noise can activate the waves and reset the silence timer. The behavior contract is [STT.md](../tests/STT.md).
