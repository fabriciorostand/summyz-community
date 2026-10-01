# Summyz commands

[Português](../pt-BR/reference/bot-commands.md) · [Documentation home](../../README.md)

## Preconditions and access

Commands are used in Discord servers. The installation must have a connected Discord account
matching the literal server owner; Summyz verifies that ownership before executing known commands.
If the account is absent, belongs to another owner, or ownership cannot be checked, the command
is refused with an ephemeral message.

| Action | Who can use it |
| --- | --- |
| Start/stop recording | Server owner, authorized roles, or individually authorized members |
| Manage forum, roles, active profile, activation, and costs | Server owner only |

Administrator and Manage Server permissions alone do not grant access. Role/member authorization
does not grant management powers. Individual grants depend on current membership and are revoked
when a member leaves. After an ownership change, `/record` also requires explicit configuration
confirmation. See [configuration](../configuration.md#server-ownership-and-access).

## Recording

### `/record`

Starts recording the standard voice channel the caller is in. Only one recording can be active
per server. The forum and complete active profile must already be configured; selected local models
must be installed and providers available. OpenRouter stages require the installation key and
capability preflight. faster-whisper requires a verified multilingual checkpoint. These checks
block capture when prerequisites fail; the owner is subject to them too.

Summyz announces recording publicly in the text chat where the command was used. Bots are excluded;
people who join the channel afterward are included. Above-recommended or unknown local hardware
assessments warn only the caller, without changing the chosen model or exposing hardware publicly.

### `/stop`

Stops the active recording. The caller must be authorized and in the same voice channel being
recorded. The confirmation is ephemeral in the interaction chat; the public stop notice mentions
the caller in the original `/record` chat.

When all humans leave, recording stops automatically and the bot leaves. The original chat identifies
the channel when its saved name is available and reports that audio will be processed. Transcription,
refinement, summary, and publication continue in the durable queue. See
[operations](../operations.md#recording-and-processing-lifecycle) for retries and recovery.

## Forum and role configuration

### `/recording-summary-forum set forum:<forum> tag:<optional tag>`

Selects the publication forum. `tag` accepts the name or ID of an existing tag and is required if
the forum requires tags. The bot validates View Channels, Send Messages, Send Messages in Threads,
Read Message History, and Attach Files before saving. Owner only; the response is ephemeral.

### `/recording-summary-forum show`

Shows the configured forum and tag, or reports that none exists. Owner only; ephemeral.

### `/recording-summary-forum clear`

Removes the destination and blocks new recordings until another forum is configured. Publications
not yet started cannot finish without a destination and follow the durable retry policy; this does
not guarantee an unlimited wait. Posts already started continue in the saved thread. Owner only;
ephemeral.

### `/recording-role add role:<role>`

Authorizes a role to start and stop recordings. Owner only; ephemeral.

### `/recording-role remove role:<role>`

Removes that role's authorization. Owner only; ephemeral.

### `/recording-role list`

Lists authorized roles. Owner only; ephemeral. Individual member grants are configured separately
through the server configuration flow, rather than these role commands.

## Active AI profile

### `/recording-profile list`

Lists complete installation profiles with their names and IDs. Owner only; ephemeral. Completeness
does not guarantee that local files are installed or that the chosen models pass recording preflight.

### `/recording-profile set profile:<profile ID>`

Selects an existing complete profile as the server's active profile. Owner only; ephemeral.
The profile can be external, local, or hybrid. Use the ID returned by `list`. It changes the choice
for new recordings and does not modify the profile pinned in an in-progress meeting.

## Ownership confirmation

### `/recording-activate`

Confirms the server configuration after an ownership change. Only the current server owner can run
it, and that owner's account must be connected to the installation. First review the forum, active
profile, and recording permissions. A forum and complete active profile are required. Confirmation
allows new recordings to proceed to their normal permission, model, and voice checks; it does not
download models or resume cancelled jobs. The response is ephemeral.

The first observed owner is confirmed automatically; a later owner requires this explicit confirmation
or the equivalent server activation flow.

## Costs

### `/recording-cost meeting id:<meeting ID>`

Shows confirmed costs for a meeting whose recording has ended. Owner only; ephemeral and scoped
to the current server. A still-recording meeting is refused. Background processing may still be
running after recording ends, so later queries can include additional attempts and charges.

For each stage the report identifies external/local execution, the effective model, and external
request count. Local stages report no measured computational cost. External amounts are the exact
USD values confirmed by OpenRouter, without display rounding. Charged failed attempts, pending
reconciliation, and automatically unattributable charges are disclosed.

### `/recording-cost period from:<YYYY-MM-DD> to:<YYYY-MM-DD>`

Aggregates meetings whose recording has ended and whose start date falls within the inclusive
interval. Owner only; ephemeral. Dates must be valid `YYYY-MM-DD`, and `from` cannot follow `to`.
Boundaries use `SUMMARY_TIME_ZONE`.

The report includes meeting counts/durations, local executions, external requests, stage totals,
confirmed averages, charged failures, and unresolved attempts. Processing after recording ends
can still change these totals. Financial records are kept independently of content/audio retention.
See [cost accounting](../operations.md#provider-cost-accounting).

## Automatic behavior and restrictions

- Profile, providers, models, languages, prompts, VAD, generation parameters, and retention choices
  are pinned when recording starts; later edits apply to new meetings.
- No provider or model is silently substituted. Local stages do not fall back to OpenRouter.
- Summary language and bot/interface language are separate choices; see
  [languages and prompts](../configuration.md#languages-and-prompts).
- A complete transcript is required for publication. Refinement failure can preserve the original
  transcript; summary failure can produce a transcript-only post.
- Losing voice connection starts automatic reconnection. Restart recovery also verifies ownership,
  bot membership, and channel availability before resuming.
- A changed owner stops active recording and suspends new recordings until configuration confirmation.
  Bot departure cancels non-terminal meetings; installation history is preserved.
- Discord exposes no public status, retry, or deletion command. Model downloads, history, retention,
  tasks, and installation administration are handled through their respective configuration/operation flows.
