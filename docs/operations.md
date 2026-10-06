# Operations

[Português](./pt-BR/operations.md) · [Documentation home](../README.md)

See [installation](./installation.md) for deployment and [configuration](./configuration.md) for
server access, profiles, models, and parameters.

## Administer the installation

Run these commands from the repository root:

```sh
./summyz-community status
./summyz-community logs
./summyz-community restart
./summyz-community down
```

Use `.\summyz-community.ps1` on Windows, or the `summyz-community-public` / `.ps1` launcher for
public installations. `down` preserves named volumes. Do not add `--volumes` unless permanent
deletion is intended.

The installation health view reports the database, bot, worker, providers, queue, and stale
heartbeats. Structured logs include failures and retry context. Discord receives generic errors
without stack traces, internal paths, credentials, or raw audio. Keep recordings, transcripts,
database dumps, and setup/recovery URLs private.

## Recording and processing lifecycle

Only one recording can be active per server. `/record` requires a verified connected owner,
an authorized caller, a publication forum, a complete active profile, available models, and a
standard voice channel. Bots are not recorded; people who join later are included.

`/stop` requires the caller to be in the recorded channel. It sends an ephemeral confirmation in
the interaction chat; the public stop message mentions that caller in the chat where `/record`
started. When everyone leaves, recording stops automatically, the bot leaves, and the original
chat reports that audio will be processed. Start, interruption, resumption, stop, transcription
failure, and publication failure notifications stay in that original chat.

The pipeline runs transcription, refinement, summary, and publication through a durable PostgreSQL
queue. Delivery is at least once: a leased job can run again after a crash or lease expiration.
Stage results are persisted and publication is resumable. Besides short provider retries, transient
failures schedule durable runs after 1 minute, 5 minutes, 15 minutes, 1 hour, and 6 hours: six runs
including the initial attempt. A missing local model keeps processing waiting for the selected
model; Summyz does not substitute it or switch to an external provider.

## Transcript and publication

Audio and the temporary `manifest.json` live under `DATA_DIR/recordings/<meetingId>`. The manifest
records participants, segments, interruptions, metrics, and the configuration fixed at recording
start. Processing synchronizes it with PostgreSQL before reserving work.

The complete transcript is written atomically as `transcript.txt` only after every segment succeeds
or is locally confirmed as silence. Refinement first preserves `transcript.raw.txt`, then updates
`transcript.txt`. Entries preserve speaker and timing, including overlaps:

```text
[00:00:10.000 – 00:00:15.000] Ana: Let's publish tomorrow.
[00:00:12.000 – 00:00:14.000] Bruno: I agree.
```

Equal display names receive stable suffixes such as `Ana #1` and `Ana #2`; user IDs remain in internal
artifacts. PCM conversion failures are retried as Ogg or packaged losslessly as WAV when possible.
No partial transcript is offered as a successful result.

Before creating a post, Summyz reads the latest forum configuration. A changed forum applies if
publication has not started; a saved thread ID keeps subsequent messages in the original post.
The post contains the meeting ID, executive summary, topics, decisions, tasks, open issues/notes,
and the full transcript attachment. Empty lists are omitted. Labels use the summary's language
when available; dates use the recorded bot language and `SUMMARY_TIME_ZONE`.

The title follows `<summary label> — <date> <HH:mm> — <voice channel name>`, with `MM/DD/YYYY` for
bot language `en` or `DD/MM/YYYY` for `pt-BR`, capped at 100 characters. Without a summary, the
post uses the transcript label, explains that the summary is unavailable, and attaches the full
transcript. Posts request seven-day inactivity auto-archiving; archiving does not delete content.

`transcription.json`, `refinement.json`, `summary.json`, and `publication.json` persist work in progress.
Message and thread IDs are saved step by step, and replies use deterministic nonces. Initial forum
post creation has no nonce, so an interruption between Discord creation and state persistence can
still duplicate a post. Summyz disables automatic mentions in publication messages.

## Failures and recovery

| Situation | Current behavior |
| --- | --- |
| Voice connection drops | Notify the original chat and attempt reconnection for `VOICE_RECONNECT_MAX_MS` (five minutes by default) |
| Process restarts | Preserve captured audio; verify bot membership, ownership, and channel availability before resuming |
| Channel is empty | Finalize partial audio and queue processing |
| Ownership verification is inconclusive during restart recovery | Keep recovery pending rather than assuming permission |
| Recovery interruption reaches thirty minutes | Finalize captured audio without resuming recording |
| Voice channel deletion is confirmed | Finalize captured audio without resuming recording |
| Refinement cannot complete | Retry; on final provider failure use the original transcript and continue |
| Summary cannot complete | Retry; on final provider failure publish the complete transcript without a summary |
| Publication fails | Preserve progress for durable retries and report a generic failure |

The thirty-minute restart recovery window is separate from the five-minute live voice reconnection
limit. An audit-log check helps confirm channel deletion when normal channel lookup cannot resolve it.

If transcription cannot complete, no `transcript.txt` is made available and the failure is persisted.
Provider failures preserve audio between durable attempts. Certain response-contract failures
(`invalid_json`, `invalid_response_shape`, `invalid_timestamps`, `missing_language`, `missing_timestamps`)
retain temporary recovery artifacts for 24 hours. When an application update increases the
transcription recovery version, eligible failed meetings are automatically queued again within
that window. Other terminal failures trigger temporary cleanup according to audio retention.

Cleanup is retried by periodic maintenance. Startup and schema migrations do not delete pending
meeting artifacts. There are no public Discord status, retry, or deletion commands.

## Ownership changes and bot departure

When Summyz detects a new server owner, it stops an active recording and suspends new recordings
until the new connected owner reviews the forum, active profile, and authorizations and confirms
them with `/recording-activate` or server activation. Captured audio is finalized for processing;
completed meetings and cost records remain available in installation history.

If the bot leaves or is removed from the server, active recording stops and non-terminal meetings
and pending jobs are marked failed with `bot_left_guild`. Temporary cleanup respects retained audio.
Historical meetings remain available; reinstalling the bot does not automatically restart those
cancelled jobs. Server configuration again requires the connected owner and installed bot.

## Bot token and application replacement

Summyz validates a replacement token and derives its Application ID before saving it. The same
stored token/application pair is a no-op. For a changed token:

- the same application cannot rotate its token while a meeting is recording; later pipeline
  stages may remain pending;
- a different application cannot replace the bot while any meeting is non-terminal.

After a successful configuration change, the supervised bot process detects it and restarts to
load the new credentials. Replacing the application clears the connected Discord account, pending
OAuth states, and old Client Secret, and revokes dashboard sessions. Configure the new application's
Client Secret and redirect, reconnect the owner, and install that bot where required. Meeting
history and financial records are preserved.

## History, costs, and tasks

Server lists retain historical servers with meetings even when the bot is absent or the connected
account changes. Historical dashboard, meeting detail, participant, export, and task queries remain
available to installation dashboard access. Editing server configuration or completing/reopening
tasks requires current connected ownership and an installed bot. This installation access is not
a separate account or permission for each Discord user.

History supports filters for date, channel, meeting ID, participant, state, and content retention.
Summary and transcript are shown only when retained for that meeting. TXT export uses the date,
time, and time-zone preferences supplied by the browser; timestamps remain in UTC in storage.

Meeting totals count completed pipelines. Talk-time rankings start with manifest v3 recordings:
word intervals are summed, same-speaker overlaps are merged, and integer rounding distributes
participation to total 100%. Silent attendees remain visible at 0%. The dashboard also shows
the current meeting, confirmed costs by processing stage, and open tasks; unresolved attempts
and the provider breakdown are shown only on the cost page.

Tasks are persisted with retained meeting content and preserve the explicitly stated assignee and
deadline. Valid normalized deadline metadata supports due-date ordering and overdue calculation
without changing the forum's literal text.
Tasks can be completed or reopened; the retained transcript and published summary are not rewritten.


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

Only the server owner can query costs with `/recording-cost meeting` or aggregate them by meeting
start date with `/recording-cost period`. These commands include meetings whose recording has ended
(`completed_at` is set); still-recording meetings are excluded. The pipeline may still be running,
and background attempts can increase the total.

Results are ephemeral and always scoped to the current Discord server. Date boundaries use
`SUMMARY_TIME_ZONE`; cost reports preserve exact financial values. Dashboard overview totals use
rounded display values; stored amounts are unchanged.

The "Details" link on the overview cost card opens the dashboard cost page. It applies the same
rule as `/recording-cost period`, but uses the browser time zone and opens on the current month.
It shows the cost of each stage, the split by provider and model with requests and charged
failures, and the five most expensive meetings in the range. Per-model and per-meeting values are
exact; the total and the stages are rounded for reading.


## Retention and backups

Content retention is enabled and audio retention disabled by default. The policies are pinned
when recording starts and apply independently:

- with content retention, PostgreSQL stores raw/refined transcripts, summary, publication, and
  manifest in `meeting_contents`;
- without it, operational processing data remains until a terminal state, then is cleared through
  the retention lifecycle; existing retained meetings are not removed by changing the server policy;
- without audio retention, audio is deleted after a complete validated transcript or terminal
  failure, subject to the 24-hour transcription recovery window;
- with audio retention, bytes remain in the durable `DATA_DIR` volume and `meeting_audio_segments`
  stores metadata and relative paths; no audio BLOB is stored in PostgreSQL;
- after terminal processing, local transcript/state files are temporary and cleaned up even when
  content was preserved in PostgreSQL;
- provider-cost records remain indefinitely in `provider_cost_attempts`, independently of content
  and audio retention.

Retained content and audio do not expire automatically. There is no built-in user deletion flow;
manual removal belongs to the operator and must preserve non-terminal meeting artifacts and
database relationships. Removing a Discord post is separate from local retention.

Back up PostgreSQL, the Summyz data volume, and `.env` together; include model volumes if you need
to preserve their downloads. The named volumes are `postgres_data`, `summyz_community_data`,
`ollama_models`, and `faster_whisper_models`. Preserve encryption keys with the data they protect.
Never publish backups or credentials.

## Installation access and password recovery

Local mode has no dashboard password and is intended for loopback access. Public mode uses one
installation password of 15–128 characters, normalized to Unicode NFC and stored as an Argon2id
hash. Session cookies are `HttpOnly`, `Secure`, and `SameSite=Strict`, with seven idle days and a
thirty-day absolute lifetime. Login attempts are throttled.

To recover access on the host:

```sh
./summyz-community-public recover-access
```

On Windows use `.\summyz-community-public.ps1 recover-access`. Recovery also works through the local
launcher when the running installation is in public mode. The single-use URL expires after ten
minutes. The old password remains valid until replacement succeeds, then prior sessions are revoked.
There is no email recovery and no recovery without host access. Do not share the generated URL.
