# Summyz Commands

## `/record`

Starts recording the voice channel you are in.

Who can use it:

- the server owner;
- members with one of the roles authorized to record.

Summyz posts a message in the text channel where the command was used to announce that recording
has started. Only one recording can be active per server. The command can be run in any server
chat, but the user must be in a standard voice channel. A forum and a complete active processing
profile must also be configured beforehand. An incomplete or incompatible profile blocks recording.

## `/stop`

Stops the server's active recording.

To use the command, you must:

- be the server owner or have an authorized role;
- be in the same voice channel that is being recorded.

The person who runs `/stop` receives an ephemeral confirmation in the command's chat. The public
stop notification, mentioning who requested it, is posted in the chat where `/record` started the
session.

If everyone leaves the channel, Summyz stops recording and leaves the channel automatically. The
original chat receives a message with the voice channel's name, stating that the segments were
preserved and will be processed. Older recordings without a saved name use the generic description
“voice channel.”

After a recording is stopped with `/stop` or because the channel is empty, transcription and
summarization begin in the background through a durable queue. The complete file is posted as an
attachment in the configured forum.
Before sending audio to the configured provider, the bot server locally discards sections without
speech and merges nearby speech from the same person without mixing participants.
When a selected local model exceeds the recommended hardware, only the person who ran `/record`
receives an ephemeral warning. The public channel receives no hardware details. Summyz preserves
the explicit choice and does not substitute a smaller model.
If the meeting cannot be fully transcribed, the channel where `/record` was run receives only a
generic warning.

When the summary is complete, the post contains an executive summary, discussed topics, decisions,
tasks, and pending items or notes. An assignee and deadline appear only when they were explicitly
stated. If summarization fails after the configured attempts, Summyz still creates a post with the
complete transcript and reports that the summary is unavailable.

## `/recording-role add role:<role>`

Authorizes a role to start and stop recordings.

Only the server owner can use this command.

## `/recording-role remove role:<role>`

Removes a role's authorization to record.

Only the server owner can use this command.

## `/recording-role list`

Shows the roles authorized to control recordings on the server.

Only the server owner can use this command.

## `/recording-summary-forum set forum:<forum> tag:<optional tag>`

Sets the forum that will receive summaries and transcripts. The tag must exist in the forum; when
the forum requires tags, this option is mandatory. The command validates the bot's permissions
before saving.

Only the server owner can use it.

## `/recording-summary-forum show`

Shows the forum and tag configured for the server. It follows the same access rules as `set`.

## `/recording-summary-forum clear`

Removes the destination. New recordings are blocked, and meetings that have not yet been published
remain pending until another forum is configured. It follows the same access rules as `set`.

## `/recording-cost meeting id:<meeting ID>`

Shows the cost of a completed meeting. Only the server owner can use it, and the response is
ephemeral. A meeting ID can be queried only in the server where that meeting was recorded.

For every phase, the report shows whether execution used an external API or a local service, the
effective model reported by the provider, and the number of external requests. Local phases show
their model but no cost: local computational cost is not measured. External values are the exact
USD amounts reported by OpenRouter and are displayed without rounding.

The report includes charged failed attempts, pending reconciliations, and attempts whose charge
could not be confirmed automatically. An active meeting is rejected with an ephemeral message;
wait until recording has ended before querying it.

## `/recording-cost period from:<YYYY-MM-DD> to:<YYYY-MM-DD>`

Shows aggregate costs for completed meetings that started in the inclusive date interval. Meetings
still in progress are excluded. Dates are interpreted with `SUMMARY_TIME_ZONE`. The report includes
the number and duration of meetings, external provider requests, local executions, phase totals,
confirmed averages, charged failures, and unresolved reconciliation counts. Only the server owner
can use it, and the response is ephemeral.

## Important Notes

- The server owner can always control recordings. Administrator and Manage Server permissions do
  not grant Summyz management access by themselves.
- Lack of authorization takes precedence over other `/record` errors; for authorized users, a
  missing forum configuration takes precedence over not being in a voice channel.
- Bots are not recorded.
- People who join the channel after recording starts are also recorded.
- If the voice connection drops, Summyz posts a warning in the text channel and attempts to resume
  for up to five minutes.
- Public notifications about recording start, connection, recording end, transcription, and
  publication remain in the chat where `/record` was run, forming a single session history.
- If the process restarts, audio already captured is preserved, and recording resumes if people are
  still in the channel.
- If the channel is empty after a restart, Summyz finalizes and processes the partial recording.
- Transient failures are retried internally; there are no public status, retry, or deletion commands
  at this stage.
- With `PERSIST_MEETING_AUDIO=false`, audio files are deleted after a valid transcription or a
  permanent failure; with `true`, they remain on disk until manually deleted by an administrator.
- Content and audio policies are fixed when `/record` starts; subsequent `.env` changes apply only
  to new meetings.
- The active profile, provider, explicit model, language, and phase parameters are also pinned then.
  A local phase never uses OpenRouter as fallback.
- Financial records are retained indefinitely, independently of audio and transcript retention.
