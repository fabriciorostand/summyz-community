# About the project

Summyz is a Discord bot that records calls on command, transcribes each participant's audio,
and publishes summaries with decisions and tasks.

# Rules

Source of truth for conventions. Every AI agent and every developer **must** follow these rules.

## TypeScript

The project must use strict TypeScript configuration.

- Do not use `any` without a recorded justification.
- Prefer `unknown` at external boundaries and validate it before use.
- Validate data from Discord, the environment, files, and APIs.
- Avoid type assertions that merely silence errors.
- Avoid non-null assertions when the state can be modeled correctly.
- Asynchronous functions must handle rejections explicitly.
- Resources such as streams, connections, and files must have a clear lifecycle.

## Language and naming

- **Code identifiers** (functions, variables, types, file/module names) → **English**.
- **Database identifiers** (**table, column, and enum** names in SQL) → **English**,
  unaccented ASCII `snake_case`.
- **Code comments** → **English**.
- **Textual artifacts** (README, documentation) → **pt-BR**.

## Methodology

### Strict TDD (red-green-refactor)
- **vitest**. Write the **failing test first**, implement the minimum, then refactor.
- Coverage **≥ 85%** (domain rules, session management, manifest creation and validation,
  transcript assembly, retention, retries, and integrations through testable adapters). Infrastructure
  glue may have lower coverage, but relevant error paths must be tested.
- Include a test that **fails if secrets or credentials leak into logs**.
- Local AI integrations must have automated smoke tests isolated from the fast suite.
  Scenarios that cannot be reproduced through code are not part of the automated criteria.

## Quality

Before considering a change complete, run the applicable scripts:

- tests;
- coverage;
- typecheck;
- lint;
- formatting.

Unused code, obsolete comments, and temporary files must be removed.

Do not add speculative abstractions. Create interfaces only at boundaries that already need to be
replaceable, testable, or isolated.

## Security and privacy

Tokens, keys, and credentials must never be committed.

- Use environment variables for secrets.
- Keep `.env` out of Git.
- Provide only `.env.example`, without real values.
- Never log tokens, authorization headers, or raw audio content.
- Treat audio and transcripts as sensitive data.
- Avoid file names built directly from user-provided content.
- Validate paths to prevent path traversal.
- Enforce size, duration, and concurrency limits.
- Do not send audio or transcripts to providers other than those configured.

## Logs and errors

Logs must be structured and written in **English**.

Log relevant events, including:

- startup and shutdown;
- joining and leaving channels;
- recording start and end;
- segment creation and finalization;
- processing start and end;
- retries;
- file deletion;
- Discord, audio, and provider errors.

Do not hide errors with empty `catch` blocks. Every failure must be handled, propagated, or logged
with enough context for diagnosis.

Messages sent to Discord must not reveal stack traces, internal paths, or secrets.

## Database migrations

- Migrations from version 10 onward must be expand-only and preserve every non-terminal meeting.
- Never delete or truncate business data, drop tables or columns, introduce cascading deletion, or
  update meeting processing data from a schema migration.
- Data cleanup belongs to the explicit retention lifecycle and may run only after a meeting reaches
  a terminal state. Startup and schema migration paths must never remove pending meeting artifacts.
- Every upgrade that changes processing or manifest schemas must include a contract test proving
  that meetings, jobs, cost attempts, manifests, and audio catalogs survive and remain recoverable.
- Applied migrations are immutable. The database records a SHA-256 checksum and startup must fail
  closed when the checked-in SQL differs from the recorded checksum.

## Git

### Commits and authorship

- **Conventional Commits in the `<type>(<scope>): <description>` format:** type/prefix in
  English + scope named according to the project + description in English. The scope indicates the
  affected area.

  Examples:
  - `feat(recording): add session creation by channel`
  - `fix(audio): preserve timestamps of simultaneous segments`
  - `test(manifest): cover recovery after interrupted write`
  - `docs(readme): document initial setup`
- **NEVER** add yourself as a co-author to commits (do not use `Co-Authored-By: Claude`).
