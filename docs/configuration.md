# Configuration

[Português](./pt-BR/configuration.md) · [Documentation home](../README.md)

Follow [installation](./installation.md) for the initial setup. This guide explains installation
credentials, server access, AI choices, and runtime parameters. Day-to-day behavior, costs, and
recovery are covered in [operations](./operations.md).

## Installation credentials and Discord connection

The bot token, Discord Client Secret, and OpenRouter key are installation secrets encrypted in
PostgreSQL with `SUMMYZ_SECRETS_KEY`, which stays in `.env`. Configure credentials through the
installation flow; their stored values are not returned to the dashboard.

The bot token is validated with Discord and determines the Application ID. The Client Secret must
belong to that application. Register `<PUBLIC_BASE_URL>/api/discord/callback` as its OAuth redirect
and connect the Discord account that owns the servers. Summyz requests `identify guilds`, stores
encrypted access and refresh tokens, and refreshes them when necessary. Authorization state is
single-use and expires after ten minutes. Connecting or replacing the account revokes existing
dashboard sessions; public installations require another password sign-in afterward.

Dashboard access and server ownership are separate checks. Local mode has no dashboard password;
public mode uses one installation password. Neither mode creates Summyz user accounts or public
registration. The Discord connection establishes whose servers can be configured.

Configure an OpenRouter key only if a selected stage uses OpenRouter. A local stage never sends
its content to OpenRouter as fallback. Token rotation and application replacement have different
restrictions; see [operations](./operations.md#bot-token-and-application-replacement).

## Server ownership and access

Server configuration requires the bot to be installed and the connected Discord account to be the
literal server owner. Administrator and Manage Server permissions do not grant Summyz management
access. All known bot commands also require that connection to match the current owner.

The owner can manage the forum, recording permissions, active profile, activation, and cost queries.
Authorized roles and individual members can start and stop recordings, without acquiring management
powers. Individual grants are tied to the member's current server membership; leaving and rejoining
does not restore a previous individual grant automatically.

The first observed owner is confirmed automatically. If ownership changes, recording access is
suspended. Connect the new owner, review the forum, profile, and recording permissions, then confirm
the configuration with `/recording-activate` or the server activation flow. A forum and complete
active profile are required for confirmation. Activation does not install models or bypass the
recording preflight checks.

Server lists also include historical servers with recorded meetings and servers owned by the
connected account where the bot can be installed. Historical meeting access is described in
[operations](./operations.md#history-costs-and-tasks).

## Forum and recording authorizations

Use Guild Install with `bot` and `applications.commands` scopes. The bot installation link requests:

- View Audit Log;
- View Channels;
- Connect;
- Send Messages;
- Send Messages in Threads;
- Read Message History;
- Attach Files.

View Audit Log supports checking whether a missing voice channel was deleted during recovery.
The bot checks effective permissions in the server, voice channel, notification chat, and publication
forum. Missing permissions or inspection failures produce structured warnings; actual Discord
operations can still fail. Installing again or changing default application permissions does not
replace the need to check the existing bot role and channel overrides.

Configure a forum and, if it requires tags, choose an existing tag. View Channels, Send Messages,
Send Messages in Threads, Read Message History, and Attach Files must be allowed in that forum.
Send Messages alone does not allow replies within a post. The slash command
`/recording-summary-forum set` validates forum permissions before saving.

Authorize roles with `/recording-role add`, or configure roles and individual members for the server.
Enable **Server Members Intent** in the Developer Portal for member lists and human role counts.
If unavailable, those directory features report `discord_members_intent_unavailable`; recording and
publication do not depend on showing those counts. See the [command reference](./reference/bot-commands.md).

## Profiles and providers per stage

Profiles are global to the installation. Each server has at most one active profile and starts
without one. A new installation creates one `Profile 1`/`Perfil 1`, named in the setup language,
with no providers or models selected.

| Stage | External provider | Local provider |
| --- | --- | --- |
| Transcription | OpenRouter | faster-whisper |
| Refinement | OpenRouter | Ollama |
| Summary | OpenRouter | Ollama |

Choose execution and a model independently for each stage. Summyz derives the profile type:
external when all stages use OpenRouter, local when all are local, and hybrid when they are mixed.
Saving requires all three stages to be complete and their models to belong to the provider catalog.
Local model files can be installed afterward; missing files block recording.

An active profile cannot be deleted. Changing a stage preserves the other stages' parameters.
The active profile, effective providers and models,
languages, prompts, VAD, generation parameters, and retention choices are pinned in the manifest
when `/record` starts. Later edits apply to new meetings and do not silently change recovery.

## Catalogs and local models

OpenRouter catalogs are filtered by stage capability: transcription needs audio input and
transcription output; refinement and summary need text input/output and advertised `response_format`
support. The STT catalog does not reliably advertise that parameter, so word timestamps are
validated in the actual transcription response. Catalog unavailability or an invalid selection
blocks validation; Summyz never selects or substitutes a model automatically.
Catalog snapshots are fresh for fifteen minutes; if refresh fails, cached data can be used for
up to 24 hours and is marked stale. Without a usable snapshot, the catalog is unavailable.

Ollama selection uses catalog families and variants. faster-whisper uses its service catalog.
Local inventory reports installed models separately from the catalog. Download the selected models
and monitor their queued, downloading, completed, cancelling, cancelled, or failed states. Transfers
can be cancelled. The managed queue accepts at most twenty active download jobs; downloads are
persisted so unfinished work can be recovered after a restart.

Local deletion is blocked while a model is needed by a non-terminal meeting, a retained recovery
window, or an active download. Deleting model files does not change a profile's selection; the
profile becomes unavailable for recording until those files are installed again.

Recommendations estimate a balance between quality and speed for the selected stage and device.
They consider CPU cores and RAM, GPU compatibility and VRAM, and model characteristics such as
quantized file size and parameter count when available. CPU and RAM estimates are limited to
resources exposed to the installation environment, including the Docker VM. These are estimates,
not benchmarks: insufficient metadata leaves the assessment unknown without replacing the choice.

Hardware assessment uses `recommended`, `compatible`, `above_recommended`, `unknown`, and
`incompatible`. The last state blocks recording; `above_recommended` and `unknown` warn privately
without changing the chosen model. Installed models and provider availability are additional checks.
faster-whisper loads the real checkpoint and requires `multilingual=true`; monolingual checkpoints
such as `tiny.en`, `base.en`, `small.en`, `medium.en`, equivalent conversions, and unknown capabilities
are blocked before capture. Ollama models are checked against structured-output contracts during
initialization. Models that fail that check are unloaded and removed when no valid stage uses them.

## Languages and prompts

There are separate language choices for the dashboard, server bot messages, transcription, and summary.
The dashboard supports `en` and `pt-BR`, detects the first supported browser language, and falls back
to English. Interface language, theme, and date/time formats are browser preferences. Dates and
filters use the browser's accepted IANA time zone, with UTC as fallback. They do not change the
language of bot messages or meeting processing.

Slash command names are always in English. Their descriptions follow each member's Discord client
language: Portuguese (Brazil) shows the Portuguese text and any other language shows English,
regardless of the server's bot message language.

The server's bot language controls recording notifications and publication date formatting. The
profile's `transcription.language` and summary `language` use the supported BCP 47 catalog and default
to `auto`. Explicit transcription language guides the provider; `auto` detects speech language and
preserves language switching. Each batch contributes once to the predominant primary language.

An explicit summary language takes precedence. With summary `auto`, Summyz uses the explicit
transcription language or, if both are `auto`, the predominant detected language. Summary generation
uses that language directly, without a translation stage. If the primary language cannot be confirmed,
Summyz generates the full summary again, for up to three total generations. It then publishes the last
result unchanged and shows a warning only in meeting detail. Short text can be inconclusive; regional
variants of the same primary language are accepted.

Transcription, refinement, summary extraction, and consolidation have editable prompts. Removing a
customization never removes the immutable base prompt that enforces language, structure, evidence,
literal-value preservation, and security. Transcripts and editable prompts are untrusted input.
Transcription defaults to no editable instruction; other defaults are stored in English and
presented in the dashboard language.

Each prompt explicitly uses `default` or `custom` mode. Changing the effective summary language
adapts default prompts while preserving custom text literally. Restoring a default sends the mode,
rather than recognizing defaults by comparing text. Effective prompts remain pinned for the meeting.

## Retention choices

New servers retain content by default and do not retain audio. Configure each policy independently
per server. Choices are pinned at recording start; editing them does not retroactively remove
previously retained meetings. Content lives in PostgreSQL; audio bytes stay in `DATA_DIR`, with
metadata and relative paths in PostgreSQL. Retained data has no automatic expiration. See
[retention and backups](./operations.md#retention-and-backups) for deletion timing and backup scope.

## Local execution and VAD

Select the device independently for each local profile stage in the dashboard: `auto`, `cpu`,
or `gpu`. New local stages default to `auto`; API stages have no device choice. `auto` uses
a compatible GPU when the corresponding service is available, otherwise CPU. An explicit GPU
choice requires that service, is disabled when unavailable, and never falls back to CPU after
saving. The effective device is pinned to the meeting at recording start. The launcher has no
device flags, and `.env` has no device selection variables. Structured logs report the active device.

CPU and GPU use separate Ollama and faster-whisper instances on the private Compose network.
CPU instances manage downloads; GPU instances share the same model files read-only. Each stage
is routed to its selected device instance. faster-whisper warms up and verifies CUDA before
processing. AMD ROCm accelerates only Ollama on Linux; faster-whisper requires NVIDIA for GPU
transcription. On AMD-only hosts, automatic local transcription uses CPU and its GPU choice
remains unavailable. Windows Docker Desktop exposes NVIDIA GPUs, not AMD. Intel and
unknown vendors have no supported acceleration container profile at this stage.

The launcher detects the host GPU and bot/API read CPU and RAM once at startup, without periodic
scans or manual refresh. Service availability is still checked when querying the catalog or
preparing a recording; those checks do not detect hardware again. After hardware changes, run the
launcher again; detection never recreates containers or expands their device access. See [Docker/WSL limits](./installation.md#windows-resources) to expose the
machine's maximum capacity on Windows.

VAD belongs to the transcription stage. OpenRouter transcription uses Summyz's Silero detector;
faster-whisper uses only its native VAD, so two detectors are never applied in sequence. VAD can be
disabled. Parameters include threshold, negative threshold, minimum speech, ending silence, and
speech padding; faster-whisper also supports maximum speech-region duration and native `auto` values.

With external VAD enabled, speech-free segments finish as silence with zero external attempts.
Speech from the same participant is consolidated into lossless WAV, with optional synthetic silence
between utterances. A time map restores original meeting timestamps without mixing participants.
Local transcription receives consolidated audio and applies the faster-whisper VAD settings.

Summyz does not globally force `think=false`, `temperature=0`, or `seed=0`. Omitted generation
options preserve provider/model defaults. OpenRouter may route within the selected model's compatible
providers; no stage has automatic fallback to another configured provider.

## Environment and runtime parameters

Use `.env.example` as the infrastructure template. The launchers generate secrets; provider, model,
language, retention, and prompt settings belong to persisted installation/server/profile configuration.

| Variable | Purpose / default |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL URL; `postgres:5432` inside Compose |
| `SUMMYZ_SECRETS_KEY` | Required encryption key generated by the launcher |
| `SUMMYZ_SETUP_TOKEN` | Required at API startup; generated by the launcher and checked for public setup |
| `WEB_HOST`, `WEB_PORT` | Native API listener or Docker dashboard publication address and port; defaults: `127.0.0.1`, `8787` |
| `PUBLIC_BASE_URL` | Dashboard origin and OAuth callback base; default `http://127.0.0.1:8787` |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Compose database credentials; password generated by the launcher |
| `POSTGRES_PORT` | Host port; `.env.example` sets `5433`, while Compose falls back to `5432` when omitted |
| `FFMPEG_PATH` | Optional absolute native FFmpeg path; otherwise use `PATH` |

The launcher creates `DATABASE_URL` for the Compose network using `postgres:5432`. For native
execution, change it to the host address and published `POSTGRES_PORT`. More runtime parameters follow.

In Docker, `WEB_HOST` controls the published IP on the host; the API listens internally on
`0.0.0.0:8787` to receive forwarded traffic. The default is `127.0.0.1`; you can select `0.0.0.0`
or an interface IP of the machine. This setting does not change Caddy's ports 80/443 or the
PostgreSQL publication. Local mode still requires no password and rejects non-loopback Host
headers and origins; publishing on another IP does not enable local browser access over the network.
The Host header does not authenticate clients: publishing local mode on external interfaces exposes
an API without a password. Use public mode with HTTPS for network access.

## Recording settings

- bot language is configured per server in the dashboard and does not change model language;
- `DATA_DIR`: file directory; default `./data`;
- `SEGMENT_SILENCE_MS`: silence that ends a segment; default `1000` ms;
- `SEGMENT_MAX_SECONDS`: maximum duration of each continuous segment; default `60` s;
- `VOICE_RECONNECT_MAX_MS`: maximum reconnection time; default `300000` ms;
- `LOG_LEVEL`: structured log level; default `info`.

Files are saved under
`data/recordings/<meetingId>/participants/<userId>/<segmentId>.ogg`. The meeting's
`manifest.json` records participants, segments, interruptions, and reception metrics.

## Transcription settings

- the OpenRouter key is an encrypted installation secret managed through the dashboard;
- `TRANSCRIPTION_CONCURRENCY`: batches processed simultaneously; default `2`;
- `TRANSCRIPTION_WINDOW_MAX_SECONDS`: maximum duration of a consolidated batch; default `30` s;
- `TRANSCRIPTION_MAX_ATTEMPTS`: total attempts per batch; default `4`;
- `TRANSCRIPTION_TIMEOUT_MS`: timeout for each attempt; default `90000` ms;
- `TRANSCRIPTION_RETRY_BASE_MS`: initial delay between retries; default `1000` ms;
- `TRANSCRIPTION_RETRY_MAX_MS`: maximum delay between retries; default `30000` ms.

The transcription phase of each profile defines:

- `provider` and `model`, both required for a complete profile;
- `language`: `auto` to detect speech language or an explicit BCP 47 tag to guide transcription;
- `temperature`: transcription temperature;
- word timestamps are mandatory; an incompatible external API response fails transcription instead
  of approximating from segments or the complete batch duration;
- `interSpeechSilenceMs`: WAV silence inserted only between actual speech intervals in the batch;
  default `0` ms;
- `mergeMaxGapMs`: maximum gap for consolidating utterances from the same person in this profile;
  default `2000` ms;
- `prompt`: editable instruction to guide transcription style, or `null` to use only the base prompt;
- `providerOptions`: optional provider-specific options grouped by provider slug according to the
  OpenRouter contract.

Only faster-whisper transcription exposes `batchSize`: `auto`, `0` to disable, or an integer from `1` to `64`.
For faster-whisper, batching is an inference optimization and still returns word timestamps.
External APIs are optimized through independent requests controlled by `TRANSCRIPTION_CONCURRENCY`.

## Refinement settings

- `provider`, `model`, `maxChunkCharacters`, `prompt`, and generation options belong to the
  profile; `maxChunkCharacters` defaults to `500000`;
- `REFINEMENT_MAX_ATTEMPTS`: total attempts per chunk; default `3`;
- `REFINEMENT_TIMEOUT_MS`: timeout for each attempt; default `120000` ms;
- `REFINEMENT_RETRY_BASE_MS`: initial delay between retries; default `1000` ms;
- `REFINEMENT_RETRY_MAX_MS`: maximum delay between retries; default `30000` ms.

Refinement receives the structured chunks produced by the transcription stage and returns only `id` and `text`
pairs. The code rejects any response that removes, adds, or reorders IDs and always reuses the
speaker and timestamps from transcription. The prompt requests a conservative review of clear spelling,
phonetic, and contextual errors while preserving each utterance's original language. It never
translates the meeting and contains no list of names, keywords, or controlled vocabulary.
When a request times out while sending or reading the response, or a model returns an incompatible
structure for a chunk containing multiple utterances, Summyz recursively divides that chunk and
retries the smaller parts. A timed-out attempt without a generation ID is finalized as an
unattributed cost failure instead of remaining pending indefinitely. Service unavailability
without a timeout and a failure for a single utterance are still propagated to the durable retry
policy.

Before the first call, Summyz atomically preserves the original output in `transcript.raw.txt`.
Provider failures first follow the configured per-call retries and the durable processing retry
policy. If the provider still fails on the final durable attempt, Summyz restores the original to
`transcript.txt`, records the fallback in `refinement.json`, and proceeds to summary and publication.
Discord does not receive a specific warning about this fallback because the original transcript
remains available.

## Summary settings

- `provider`, `model`, `language`, `maxChunkCharacters`, `extractionPrompt`,
  `consolidationPrompt`, and generation options belong to the profile;
  `maxChunkCharacters` defaults to `500000`;
- `SUMMARY_MAX_ATTEMPTS`: total attempts per model call; default `4`;
- `SUMMARY_TIMEOUT_MS`: timeout for each attempt; default `120000` ms;
- `SUMMARY_RETRY_BASE_MS`: initial delay between retries; default `1000` ms;
- `SUMMARY_RETRY_MAX_MS`: maximum delay between retries; default `30000` ms;
- `SUMMARY_TIME_ZONE`: IANA time zone used in the post title and cost-report date filters; default
  `America/Sao_Paulo`.

The summary uses validated structured output. Transcripts larger than the configured limit are
split only between utterances, summarized in chunks, and consolidated. Summyz internally retains
the references to utterances that support decisions and tasks but does not publish this evidence. A
decision or task without a valid reference is removed. Assignees and deadlines are preserved only
when they appear exactly in the referenced utterance; explicit tasks may remain without these
fields.

Vague requests such as “someone needs to choose the tool” are not promoted to decisions or tasks:
they appear under **Open issues and notes** in English or **Pendências e observações** in Portuguese.
Discord preserves the original deadline text. The structured result may also retain a validated
date or minute deadline and its meeting time zone for dashboard scheduling; that metadata never
replaces the literal text in the forum post.
