<p align="center">
  <img src="./assets/banner.png" width="820" alt="Summyz — recording and transcription bot for Discord" />
</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.pt-BR.md">Português</a>
</p>

<p align="center">
  <b>Summyz</b> records voice calls on command, transcribes each participant's audio, and publishes
  summaries with decisions and tasks.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D22.5-339933?logo=node.js&logoColor=white" alt="Node >= 22.5" />
  <img src="https://img.shields.io/badge/PRs-welcome-23A559" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/self--hosted-100%25-0A0B0F" alt="Self-hosted" />
</p>

---

Summyz records each participant separately and, after the voice call ends normally, transcribes the
segments through the configured provider and assembles a single file while preserving speakers, timestamps, and
overlapping speech. A second stage reviews only the transcript text without allowing the model to
change IDs, speakers, timestamps, or order. It then generates a structured summary and publishes the
executive summary, discussed topics, decisions, tasks, and full transcript in a Discord forum post.

## Requirements

- Node.js 22.12 or later;
- npm;
- Docker with Compose to run the bot and, in PostgreSQL mode, the database;
- PostgreSQL 18 only when `STORAGE_MODE=postgres`;
- a bot application created in the Discord Developer Portal;
- an OpenRouter account with credits and an API key only for stages configured with `openrouter`;
- FFmpeg does not need to be installed separately: the project uses a bundled binary.

## Local setup

1. Install the dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. Fill in `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Select the provider for each AI stage. Fill in
   OpenRouter credentials and models only for stages that use it.
4. Choose `STORAGE_MODE=local` to run without a database. For `STORAGE_MODE=postgres`, set
   `POSTGRES_PASSWORD` and `DATABASE_URL`; use the `postgres` host with Compose or `localhost`
   with npm.
5. Set `PERSIST_MEETING_CONTENT` and `PERSIST_MEETING_AUDIO` according to the desired policy.
6. For development, set `DISCORD_GUILD_ID` to the test server ID. Without this variable, commands
   are registered globally and may take some time to appear.
7. Run `docker compose up -d --build`. Compose starts the bot, Ollama, and faster-whisper; it only
   downloads local models selected by the configuration. Add `--profile postgres` for PostgreSQL.
   `npm run dev` remains available for development while local AI services run in Compose.

If local port `5432` is already in use, change `POSTGRES_PORT` and adjust the port in
`DATABASE_URL`. PostgreSQL is exposed only on `127.0.0.1`; the connection between containers
continues to use `postgres:5432`.

Never commit the `.env` file or publish the bot token.

In local mode, the bot neither creates a connection to nor requires PostgreSQL. In PostgreSQL mode,
migrations and the connection are validated before the Discord login; if the database is
unavailable or the URL is invalid, the process exits with a safe message. The same happens if a
PostgreSQL meeting pending recovery exists on disk and `DATABASE_URL` is unavailable. The
`postgres_data` and `summyz_data` volumes preserve the database and required files across
restarts.

## Persistence and privacy

- `STORAGE_MODE=local` is the default and stores the manifest, queue, attempts, and operational
  states in atomic files under `DATA_DIR`, without requiring a database;
- `STORAGE_MODE=postgres` stores configuration, minimal meeting data, the queue, and attempts in
  PostgreSQL; `DATABASE_URL` becomes required;
- `PERSIST_MEETING_CONTENT=false` is the default. After the terminal state, transcripts, the
  summary, and local states are removed. The backend retains only the operational minimum required
  for the queue and for diagnosing its completion;
- with `PERSIST_MEETING_CONTENT=true`, local mode preserves the stage 3 files; PostgreSQL mode
  preserves the raw and refined transcripts, summary, publication, and manifest in
  `meeting_contents`;
- `PERSIST_MEETING_AUDIO=false` is the default: audio is deleted after a fully validated
  transcription or after all durable attempts are exhausted;
- with `PERSIST_MEETING_AUDIO=true`, audio remains in `DATA_DIR` indefinitely. In local mode,
  `audio-manifest.json` catalogs the segments; in PostgreSQL mode, the
  `meeting_audio_segments` table stores metadata and relative paths;
- audio is never stored as a BLOB in PostgreSQL. Even in this mode, the bytes remain in the durable
  volume mounted at `DATA_DIR`;
- in PostgreSQL mode, the local `manifest.json` acts as a temporary recovery record alongside the
  audio; processing synchronizes it with the database before reserving the job;
- preserved content and audio do not expire automatically. Deletion is a manual administrator
  operation on disk or in the database.
- provider-cost records never expire automatically and are independent of content and audio
  retention. Local mode keeps them under `DATA_DIR/costs/guilds/<guildId>/meetings/<meetingId>`;
  PostgreSQL mode uses `provider_cost_attempts` with protected meeting and server relationships.

## Provider cost accounting

Every model invocation is recorded before it is sent. OpenRouter responses use the provider's
reported `usage.cost` in USD; Summyz does not calculate a price estimate. Application retries are
separate attempts, and a failed call is included whenever OpenRouter confirms a charge. A
`generation_id` is retained and queried to reconcile responses that did not contain complete cost
or effective-model metadata.

If a transport failure prevents both the response and generation ID from reaching Summyz, the
attempt is marked as not automatically attributable instead of being treated as free. Reports show
this condition and never present the confirmed subtotal as necessarily complete. Local Ollama and
faster-whisper calls retain the effective model with a null external cost because computational
cost is outside the current scope.

Server administrators can query a completed meeting with `/recording-cost meeting` or aggregate
completed meetings by their start date with `/recording-cost period`; meetings still in progress
are excluded. Results are ephemeral and always scoped to the current Discord server. Date boundaries
use `SUMMARY_TIME_ZONE`; financial values are stored and displayed without rounding.

The three choices are copied to the manifest when the meeting starts. Changing `.env` afterward
does not migrate or redirect a meeting already in progress: a local meeting remains local, and a
PostgreSQL meeting continues to depend on PostgreSQL until it reaches a terminal state.

Processing uses a durable queue in `processing.json` in local mode or in PostgreSQL in the other
mode. Delivery is *at least once*: if the process stops after reserving a job and before confirming
the result, that job may run again after a restart or lease expiration. The stages and publication
are idempotent so that a repeat does not intentionally create another meeting. In addition to fast
provider retries, a transient failure schedules durable runs after 1 minute, 5 minutes, 15 minutes,
1 hour, and 6 hours (six runs in total, including the initial one).

## Discord Developer Portal setup

1. Open the Summyz application in the Discord Developer Portal.
2. Under **Bot**, create or reset the token and save it as `DISCORD_TOKEN` in `.env`.
3. Still under **Bot**, keep **Privileged Gateway Intents** disabled. The current implementation
   uses only the standard `Guilds` and `Guild Voice States` intents.
4. Under **Installation**, configure **Guild Install** with the `bot` and
   `applications.commands` scopes.
5. In the default installation permissions, grant the bot:

- View Channels;
- Connect;
- Send Messages;
- Send Messages in Threads;
- Read Message History;
- Attach Files;
- Use Application Commands.

Use the link provided on the **Installation** page to add the bot to the server. If the bot is
already installed, changing the default permissions in the Developer Portal does not automatically
update the existing role: adjust the bot role permissions and the overrides for the channel where
meetings will be published, or reinstall the bot with the new link.

Send Messages, Send Messages in Threads, Read Message History, and Attach Files must also be allowed
in the forum-specific settings when overrides exist. `Send Messages` alone does not allow replies
inside a post.

After adding the bot, use `/recording-role add` to authorize the desired roles and
`/recording-summary-forum set` to select the publication forum. New recordings remain blocked
until a forum is configured. See [BOT_COMMANDS.md](./BOT_COMMANDS.md) for all commands and access
rules.

## Recording settings

- `BOT_LANGUAGE`: language used for fixed Discord text and command descriptions; `en` or `pt-BR`;
  default `en`. This setting does not change model language;
- `DATA_DIR`: file directory; default `./data`;
- `SEGMENT_SILENCE_MS`: silence that ends a segment; default `1000` ms;
- `SEGMENT_MAX_SECONDS`: maximum duration of each continuous segment; default `60` s;
- `VOICE_RECONNECT_MAX_MS`: maximum reconnection time; default `300000` ms;
- `LOG_LEVEL`: structured log level; default `info`.

Files are saved under
`data/recordings/<meetingId>/participants/<userId>/<segmentId>.ogg`. The meeting's
`manifest.json` records participants, segments, interruptions, and reception metrics.

## Transcription settings

- `OPENROUTER_API_KEY`: key used for the transcription, refinement, and summary endpoints;
- `OPENROUTER_TRANSCRIPTION_MODEL`: STT model selected in OpenRouter, with no implicit default;
- `TRANSCRIPTION_MODEL_PROFILES_FILE`: JSON file containing each model's individual
  configuration; default `./config/transcription-model-profiles.json`;
- `TRANSCRIPTION_CONCURRENCY`: batches processed simultaneously; default `2`;
- `TRANSCRIPTION_VAD_THRESHOLD`: minimum speech probability in the local Silero detector;
  default `0.5`;
- `TRANSCRIPTION_VAD_MIN_SPEECH_MS`: approximate minimum speech duration; default `96` ms;
- `TRANSCRIPTION_MERGE_MAX_GAP_MS`: maximum gap for consolidating nearby utterances from the same
  person; default `2000` ms;
- `TRANSCRIPTION_WINDOW_MAX_SECONDS`: maximum duration of a consolidated batch; default `30` s;
- `TRANSCRIPTION_MAX_ATTEMPTS`: total attempts per batch; default `4`;
- `TRANSCRIPTION_TIMEOUT_MS`: timeout for each attempt; default `90000` ms;
- `TRANSCRIPTION_RETRY_BASE_MS`: initial delay between retries; default `1000` ms;
- `TRANSCRIPTION_RETRY_MAX_MS`: maximum delay between retries; default `30000` ms.

The configured model must have an entry with the same slug in
[`config/transcription-model-profiles.json`](./config/transcription-model-profiles.json). Summyz
validates every profile and fails before connecting to Discord if the file is invalid or the active
model has no profile. The model is still selected through `.env`; no configuration from one
profile is inherited by another.

Each profile defines:

- `language`: language sent to the provider; when omitted, automatic detection is used;
- `temperature`: transcription temperature;
- `timestampMode`: `word` for detailed timestamps or `batch` for text without timestamps;
- `interSpeechSilenceMs`: WAV silence inserted only between actual speech intervals in the batch;
- `mergeMaxGapMs`: optional override of the global maximum gap for consolidating utterances from
  the same person;
- `prompt`: optional text instruction to guide transcription style;
- `providerOptions`: optional provider-specific options grouped by provider slug according to the
  OpenRouter contract.

Profiles do not pin a language: `TRANSCRIPTION_LANGUAGE` controls that decision. With `auto`,
Summyz uses automatic detection and local selection prioritizes the best overall multilingual
quality. With an explicit language, support and quality for that language participate in ranking.
The `deepgram/nova-3` profile inserts 350 ms between speech intervals. This value was selected in a
controlled test: 200 and 500 ms dropped the negation, while 350 ms preserved the full utterance,
“No, I agree. Really.” The `smart_format` and `utterances` options were not enabled because they
produced worse results for this audio.

The `mistralai/voxtral-mini-transcribe` model has a dedicated profile because its OpenRouter
integration accepts only `response_format: "json"`, rejects `pt-BR`, and does not return
timestamps. For this model, Summyz uses automatic language detection and represents each response
with the start and end of the actual speech batch sent. Speakers and overlaps therefore remain
preserved, but timestamps are precise per batch rather than per word or sentence.

The `openai/gpt-transcribe` and `openai/gpt-4o-transcribe` profiles use `temperature: 0`, one JSON
response per batch, and do not merge distinct segments. The `openai/gpt-transcribe` profile uses a
language-neutral prompt to guide literal transcription in the original language and preserve
hesitations, with no synthetic pause. The `openai/gpt-4o-transcribe` profile uses no prompt and
inserts 350 ms between internal speech intervals. Neither configures `keywords`, names, specific
terms, or any other controlled vocabulary.

Although the direct OpenAI API documents detailed formats for `gpt-transcribe`, OpenRouter's
current endpoint rejects word-level timestamp requests. Each line therefore represents a single
segment and preserves the temporal order of utterances and overlaps.

The `openai/gpt-transcribe` slug is already accepted by OpenRouter's transcription endpoint even
though it does not appear in the public catalog returned by `/api/v1/models` at the time of this
documentation.

Before calling the API, Summyz decodes audio locally and uses Silero VAD to confirm that speech is
present. Segments without speech are completed as silence with zero external attempts and do not
bring together utterances that were far apart in the voice call. Only intervals detected as speech
are consolidated into lossless WAV when the actual gap between them does not exceed 2 seconds, in
windows of up to 30 seconds from the same person. Depending on the active profile, short synthetic
silences may separate these intervals to preserve utterance boundaries. A time map excludes these
pauses and places each excerpt back on the original clock after transcription, without mixing
participants.

OpenRouter may route a request among providers compatible with the selected model. Summyz accepts
this routing within an OpenRouter stage. A stage configured as local never sends its content to
OpenRouter and has no cross-provider fallback. Local services stay on the private Compose network;
downloads and validation run in the background without blocking Discord startup.

If the machine is below the hardware recommendation for a fully local setup, Summyz still selects
the smallest compatible local models and attempts processing. It warns only the terminal and the
person who ran `/record`; processing may be slow and output quality may be lower than desired. The
durable queue remains responsible for actual service unavailability and transient failures.

## Refinement settings

- `OPENROUTER_REFINEMENT_MODEL`: text model that reviews the STT output; the example recommends
  `google/gemini-3.7-flash`;
- `REFINEMENT_CHUNK_MAX_CHARACTERS`: approximate maximum size of each chunk, always split between
  utterances; default `500000` characters;
- `REFINEMENT_MAX_ATTEMPTS`: total attempts per chunk; default `3`;
- `REFINEMENT_TIMEOUT_MS`: timeout for each attempt; default `120000` ms;
- `REFINEMENT_RETRY_BASE_MS`: initial delay between retries; default `1000` ms;
- `REFINEMENT_RETRY_MAX_MS`: maximum delay between retries; default `30000` ms.

Refinement receives the structured chunks produced by Whisper and returns only `id` and `text`
pairs. The code rejects any response that removes, adds, or reorders IDs and always reuses the
speaker and timestamps from Whisper. The prompt requests a conservative review of clear spelling,
phonetic, and contextual errors; it contains no list of names, keywords, or controlled vocabulary.

Before the first call, Summyz atomically preserves the original output in `transcript.raw.txt`. If
the model or structured response fails all three attempts, it restores the original to
`transcript.txt`, records the fallback in `refinement.json`, and proceeds normally to the
summary and publication. Discord does not receive a specific warning about this fallback because
the original transcript remains available.

## Summary settings

- `OPENROUTER_SUMMARY_MODEL`: text model used for the summary, configured separately from the
  transcription model; the example recommends `google/gemini-3.7-flash`;
- `SUMMARY_CHUNK_MAX_CHARACTERS`: approximate maximum size of each transcript chunk; default
  `500000` characters;
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
Deadlines remain in their original text, without automatically converting expressions such as
“tomorrow” or “by Friday.”

## Transcription output

Transcription starts automatically when `/stop` finishes the recording or when everyone leaves
the channel. After a restart, the bot resumes recording if people are still present; if the channel
is empty, it finalizes the partial audio and processes it normally.

The result is written atomically to:

```text
data/recordings/<meetingId>/transcript.txt
```

When refinement starts, the unreviewed version is preserved at
`data/recordings/<meetingId>/transcript.raw.txt`; `transcript.txt` then contains the reviewed
version or remains identical to the original when a fallback occurs.

Each excerpt follows this format:

```text
[00:00:10.000 – 00:00:15.000] Ana: Let's publish tomorrow.
[00:00:12.000 – 00:00:14.000] Bruno: I agree.
```

Overlapping intervals represent overlapping speech. If two participants have the same display name,
the file uses stable suffixes such as `Ana #1` and `Ana #2`, keeping IDs only in internal
artifacts.

The file is created only after every segment succeeds or is locally confirmed as silence. A PCM
conversion that failed during recording is retried as Ogg and, if necessary, packaged losslessly as
WAV. If any segment remains impossible to analyze or process, or the provider exhausts its retries:

- no `transcript.txt` is made available;
- the failure is persisted in `transcription.json`;
- Discord receives only a generic warning, with no internal details;
- audio is preserved between durable attempts;
- after the final attempt, Discord receives the generic warning and the temporary artifacts are
  deleted.

## Publishing to Discord

After transcription and summarization, Summyz reads the server's latest configuration and creates a
post in the selected forum. With `BOT_LANGUAGE=en`, a successful post is named
`Summary — MM/DD/YYYY HH:mm — Voice channel name`; with `BOT_LANGUAGE=pt-BR`, it uses
`Resumo — DD/MM/AAAA HH:mm — Nome do canal de voz`. The post contains:

- the meeting ID and executive summary in the first message;
- discussed topics (`Discussed topics` or `Tópicos discutidos`);
- decisions (`Decisions` or `Decisões`);
- tasks (`Tasks` or `Tarefas`), with an assignee and deadline only when explicit;
- open issues and notes (`Open issues and notes` or `Pendências e observações`);
- `transcript.txt` as an attachment.

Discord moves the post to the older posts section after up to seven days of inactivity; the content
is not deleted and can be reopened.

If the summary continues to fail after all retries, Summyz uses `Transcript` in the English post
title or `Transcrição` in the Portuguese title. The first message states that the summary is
unavailable and includes `transcript.txt` as an attachment.

The chat where `/record` was run contains the session's public history: start, failure to start,
interruption, resumption, permanent reconnection failure, manual stop, empty channel, shutdown,
transcription failure, and publication failure. When `/stop` is used, only the person who ran the
command receives an ephemeral confirmation in the interaction chat with a reference to the
original chat; the public stop notice mentions that person in the `/record` chat. For an automatic
stop, the notice identifies the voice channel when its name is available and states that the
segments will be processed. If the forum is changed before publication begins, the meeting uses
the latest destination; a publication already started or completed remains in the original post.

While the job is in progress, states remain in the durable volume in `refinement.json`,
`summary.json`, and `publication.json`. Message and thread IDs are persisted at each step, and
responses use deterministic nonces, allowing publication to resume after a restart and reducing
duplicates. The initial creation of forum posts does not support a nonce through the Discord API;
therefore, idempotency is guaranteed under normal conditions, but absolute atomicity between the
volume and Discord is not.

When `PERSIST_MEETING_AUDIO=false`, audio is deleted as soon as the complete transcript is
validated and persisted, or after a permanent failure. After publication, the remaining temporary
files are deleted if `PERSIST_MEETING_CONTENT=false`. Enabled copies remain in the backend
selected when the meeting started until an administrator intervenes.

## Quality

Run `npm run check` before submitting changes. This command validates formatting, linting, types,
tests, and coverage. Run `npm run security:audit` to check dependencies.

The MVP's Opus decoder is `opusscript`, avoiding the vulnerable dependency chain found in the
native dependency that was evaluated. The local-service smoke test is automated inside the private
Compose network with `docker compose --profile smoke run --rm smoke`; it downloads small models and
may take a while on its first run. Real Discord interactions are not presented as automated tests.

## Contributing

Contributions are welcome.

1. Fork the repo and create a feature branch.
2. Keep modules small and single-purpose; follow the existing structure.
3. Add tests for new logic — `npm test` must pass.
4. Open a pull request describing the change and the reasoning.

For bugs and feature requests, please open an issue.
