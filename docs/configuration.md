# Configuration

[Português](./pt-BR/configuration.md) · [Documentation home](../README.md)

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

Only the server owner can query a completed meeting with `/recording-cost meeting` or aggregate
completed meetings by their start date with `/recording-cost period`; meetings still in progress
are excluded. Results are ephemeral and always scoped to the current Discord server. Date boundaries
use `SUMMARY_TIME_ZONE`; financial values are stored and displayed without rounding.

The persistence choices and complete active profile — providers, models, languages, and parameters
— are copied to the manifest when the meeting starts. Editing or activating another profile later
does not change an in-progress meeting.

Processing uses a durable PostgreSQL queue. Delivery is *at least once*: if the process stops after
reserving a job and before confirming
the result, that job may run again after a restart or lease expiration. The stages and publication
are idempotent so that a repeat does not intentionally create another meeting. In addition to fast
provider retries, a transient failure schedules durable runs after 1 minute, 5 minutes, 15 minutes,
1 hour, and 6 hours (six runs in total, including the initial one).

## Discord Developer Portal setup

1. Open the Summyz application in the Discord Developer Portal.
2. Under **Bot**, create or reset the token and enter it during dashboard setup. It is encrypted in
   PostgreSQL with the master key kept in `.env`.
3. Still under **Bot**, enable the privileged **Server Members Intent**. Summyz uses the `Guilds`,
   `Guild Members`, and `Guild Voice States` intents; the members intent lets it count only the
   human members visible to the bot in each role. If it is disabled, recording and publication
   continue to work, but the API reports `discord_members_intent_unavailable` and does not show
   potentially incorrect counts.
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
until a forum is configured. See [bot command reference](./reference/bot-commands.md) for all commands and access
rules.

Only the literal Discord server owner can manage the forum, authorized roles, and costs.
Administrator or Manage Server permissions do not grant management access. The owner and roles the
owner authorizes may use `/record` and `/stop`; authorized roles receive no other powers.

## Processing profiles

Profiles are global to the installation and can be reused across every server where its bot is
installed. The **Profiles** page separates **External API** and **Local** configurations. A fresh
installation receives one profile of each type with empty model fields. An active profile cannot
be deleted.

Each server has at most one active profile, regardless of type. New servers start without one;
until transcription, refinement, and summary have explicit models, `/record` shows an ephemeral
warning and does not start. Selecting an explicit language also makes the translation model
mandatory, so the profile immediately becomes incomplete until it is filled. Changing a model
preserves the profile's other parameters. If the bot leaves a server, that server disappears from
the dashboard while its persisted data is retained. Reinstalling the same bot in that server makes
the data available again.

There is no model `auto` or `openrouter/auto`. Model selection is unrestricted and Summyz never
replaces a selected model. Local evaluation uses `recommended`, `compatible`,
`above_recommended`, `unknown`, and `incompatible`; only `incompatible` blocks recording, while
`above_recommended` and `unknown` produce private warnings. Language is a primary profile setting
with a searchable catalog of BCP 47 tags and defaults to `auto`. Each phase stores its own provider,
model, and parameters, including STT batching/options, chunk sizing, and the generation
options `temperature`, `seed`, and `think` where applicable. Unset values are not forced by Summyz,
preserving provider defaults.

The dashboard displays the editable transcription, refinement, summary extraction, consolidation,
and translation prompts. **No prompt** removes only the customization: Summyz always sends an
immutable base prompt that pins language, structure, evidence, literal-value preservation, and
security rules. Transcripts and editable prompts are untrusted content. Transcription defaults to
no editable prompt. The remaining
defaults are created in English or Brazilian Portuguese according to the installation's dashboard
language, while asking for the summary output language selected in the profile. Changing that
language adapts prompts that still match the previous default and preserves customized text. The
**Restore default** action uses the current dashboard language. Effective prompts and models are
pinned in the meeting manifest and cannot silently change on resume.

With `auto`, transcription preserves language switching, every batch contributes once to a single
predominant primary tag, and the summary is published in that language. With an explicit tag, the
base summary is validated and stored in the predominant language before translation. Translation is
skipped when both exact tags match. Transcription and refinement are never translated. After
translation retries are exhausted, Summyz publishes the base summary and sends a private DM only to
the `/record` author; there is no public notice or DM fallback.

External profiles preflight transcription modality and structured-output contracts through the
OpenRouter catalog before recording. Local profiles load the faster-whisper checkpoint and require
the real checkpoint to report `multilingual=true`. `tiny.en`, `base.en`, `small.en`, `medium.en`,
equivalent converted checkpoints, and checkpoints with an unknown capability are blocked before
audio capture or provider processing. Summyz adds no auxiliary detector and maintains no generative
model/language compatibility catalog.

Database migrations normalize profiles created before prompt keys became mandatory. Existing prompt
text is preserved, missing transcription prompts become `null`, and missing refinement or summary
prompts receive the localized defaults. Runtime code accepts only the current profile contract.

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
- `TRANSLATION_MAX_ATTEMPTS`: translation attempts; default `3`;
- `TRANSLATION_TIMEOUT_MS`: timeout per translation attempt; default `120000` ms;
- `TRANSLATION_RETRY_BASE_MS`: initial translation retry delay; default `1000` ms;
- `TRANSLATION_RETRY_MAX_MS`: maximum translation retry delay; default `30000` ms.

The transcription phase of each profile defines:

- `provider` and `model`, both required for a complete profile;
- transcription always uses automatic detection; the profile language controls only the effective
  summary language;
- `temperature`: transcription temperature;
- word timestamps are mandatory; an incompatible external API response fails transcription instead
  of approximating from segments or the complete batch duration;
- `interSpeechSilenceMs`: WAV silence inserted only between actual speech intervals in the batch;
- `mergeMaxGapMs`: optional override of the global maximum gap for consolidating utterances from
  the same person;
- `prompt`: editable instruction to guide transcription style, or `null` to use only the base prompt;
- `providerOptions`: optional provider-specific options grouped by provider slug according to the
  OpenRouter contract.

Only local profiles expose `batchSize`: `auto`, `0` to disable, or an integer from `1` to `64`.
For faster-whisper, batching is an inference optimization and still returns word timestamps.
External APIs are optimized through independent requests controlled by `TRANSCRIPTION_CONCURRENCY`.

## Dashboard and history

Dashboard and History expose only servers where the configured bot is installed. Their server selector is
shared and persisted in the browser. Call-count and duration totals include old and new meetings
whose pipeline completed; speaker rankings begin with meetings recorded using manifest v3. Talk time
sums word intervals, unions overlaps from the same person, and distributes integer rounding so the
result totals exactly 100%. Silent attendees remain visible with `0%`.

Dates and filter boundaries use `SUMMARY_TIME_ZONE`. Summary and transcript content is available only
when retention was enabled for that meeting. Dashboard cost totals include all confirmed attempts and
warn when pending or unattributed values remain.

If the profile list or a server configuration cannot be loaded, the dashboard shows a generic error
and offers an in-page retry. Dependency and persisted-data details remain only in structured server
logs.

VAD is configured in its own profile tab and can be disabled. External API profiles use Summyz's
Silero detector before sending audio to OpenRouter. Local profiles skip that detector and use only
faster-whisper's native VAD, so two VADs are never applied in sequence. Each profile type preserves
the defaults and limits of its detector. Speech threshold, negative threshold, minimum speech,
ending silence, and speech padding are persisted in the profile; local profiles also expose the
maximum speech-region duration. `auto` preserves faster-whisper's established normal or batched
behavior.

With an external API profile and VAD enabled, speech-free segments complete as silence with zero
external attempts. Detected speech intervals are consolidated into lossless WAV within the
configured limits. Short synthetic silences can preserve utterance boundaries, and a time map
restores each piece to the original meeting clock. With a local profile, consolidated audio reaches
faster-whisper, which applies its own VAD from the profile configuration.

OpenRouter may route a request among providers compatible with the selected model. Summyz accepts
this routing within an OpenRouter stage. A stage configured as local never sends its content to
OpenRouter and has no cross-provider fallback. Local services stay on the private Compose network.
`LOCAL_AI_DEVICE=auto|gpu|cpu` controls execution, while `LOCAL_AI_FALLBACK=none|cpu` separately
authorizes CPU fallback. In `auto`, a detected GPU that is incompatible with a phase does not cause
an implicit CPU switch. CPU mode always has an effective fallback of `none` and never receives GPU
access. Required acceleration is warmed up and validated before processing; the active device is
only emitted in structured logs.

In this stage, faster-whisper GPU transcription supports NVIDIA/CUDA only. AMD is supported for
Ollama on Linux through ROCm, but a profile requiring faster-whisper on an AMD GPU is incompatible
and cannot start recording. AMD transcription through whisper.cpp/Vulkan or ROCm remains a future
stage. Docker Desktop on Windows exposes NVIDIA GPUs, not AMD GPUs.

If a selected model is above the hardware recommendation, Summyz keeps it and warns only the person
who ran `/record`; it does not replace it with a smaller model. Incompatible models block recording.

Summyz does not globally force `think=false`, `temperature=0`, or `seed=0`. That combination may be
saved in a profile for hardware where it was validated; omitted values preserve the model and
provider defaults.

## Refinement settings

- `provider`, `model`, `maxChunkCharacters`, `prompt`, and generation options belong to the
  profile;
- `REFINEMENT_MAX_ATTEMPTS`: total attempts per chunk; default `3`;
- `REFINEMENT_TIMEOUT_MS`: timeout for each attempt; default `120000` ms;
- `REFINEMENT_RETRY_BASE_MS`: initial delay between retries; default `1000` ms;
- `REFINEMENT_RETRY_MAX_MS`: maximum delay between retries; default `30000` ms.

Refinement receives the structured chunks produced by Whisper and returns only `id` and `text`
pairs. The code rejects any response that removes, adds, or reorders IDs and always reuses the
speaker and timestamps from Whisper. The prompt requests a conservative review of clear spelling,
phonetic, and contextual errors; it contains no list of names, keywords, or controlled vocabulary.
When a request times out while sending or reading the response, or a model returns an incompatible
structure for a chunk containing multiple utterances, Summyz recursively divides that chunk and
retries the smaller parts. A timed-out attempt without a generation ID is finalized as an
unattributed cost failure instead of remaining pending indefinitely. Service unavailability
without a timeout and a failure for a single utterance are still propagated to the durable retry
policy.

Before the first call, Summyz atomically preserves the original output in `transcript.raw.txt`. If
the model or structured response fails all three attempts, it restores the original to
`transcript.txt`, records the fallback in `refinement.json`, and proceeds normally to the
summary and publication. Discord does not receive a specific warning about this fallback because
the original transcript remains available.

## Summary settings

- `provider`, `model`, `language`, `maxChunkCharacters`, `extractionPrompt`,
  `consolidationPrompt`, and generation options belong to the profile;
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
