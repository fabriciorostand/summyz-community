# Operations

[Português](./pt-BR/operations.md) · [Documentation home](../README.md)

## Persistence and privacy

- PostgreSQL stores configuration, profiles, meetings, the queue, and attempts; `DATABASE_URL` is
  required;
- content retention is enabled by default for each new server and can be changed in the dashboard;
- when enabled, PostgreSQL preserves the raw and refined transcripts, summary, publication, and
  manifest in `meeting_contents`;
- audio retention is disabled by default: audio is deleted after a fully validated
  transcription or after all durable attempts are exhausted;
- when enabled in the dashboard, audio remains in `DATA_DIR` indefinitely, while the
  `meeting_audio_segments` table stores metadata and relative paths;
- audio is never stored as a BLOB in PostgreSQL. Even in this mode, the bytes remain in the durable
  volume mounted at `DATA_DIR`;
- the local `manifest.json` acts as a temporary recovery record alongside the
  audio; processing synchronizes it with the database before reserving the job;
- preserved content and audio do not expire automatically. Deletion is a manual administrator
  operation on disk or in the database.
- provider-cost records never expire automatically and are independent of content and audio
  retention. PostgreSQL uses `provider_cost_attempts` with protected meeting and server
  relationships.

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
post in the selected forum. With server language `en`, a successful post is named
`Summary — MM/DD/YYYY HH:mm — Voice channel name`; with `pt-BR`, it uses
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

When audio retention is disabled, audio is deleted as soon as the complete transcript is
validated and persisted, or after a permanent failure. After publication, the remaining temporary
files are deleted if content retention is disabled. Retained content remains in PostgreSQL, and
retained audio remains in `DATA_DIR`, until the operator deletes it.
