<p align="center">
  <img src="./assets/banner.png" width="820" alt="Summyz — recording and transcription bot for Discord" />
</p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./docs/pt-BR/README.md">Português</a>
</p>

<p align="center">
  <b>Summyz Community</b> records voice calls on command, transcribes each participant's audio, and publishes
  summaries with decisions and tasks.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/node-%3E%3D22.12-339933?logo=node.js&logoColor=white" alt="Node >= 22.12" />
  <img src="https://img.shields.io/badge/PRs-welcome-23A559" alt="PRs welcome" />
  <img src="https://img.shields.io/badge/self--hosted-100%25-0A0B0F" alt="Self-hosted" />
  <img src="https://img.shields.io/badge/license-source--available-6E40C9" alt="Source-available license" />
</p>

---

Summyz records each participant separately and, after the voice call ends normally, transcribes the
segments through the configured provider and assembles a single file while preserving speakers, timestamps, and
overlapping speech. A second stage reviews only the transcript text without allowing the model to
change IDs, speakers, timestamps, or order. It then generates a structured summary and publishes the
executive summary, discussed topics, decisions, tasks, and full transcript in a Discord forum post.

## Requirements

- Docker with Compose;
- a bot application created in the Discord Developer Portal;
- an OpenRouter account with credits and an API key only for stages configured with `openrouter`;
- compatible host drivers and Docker integration when NVIDIA or AMD acceleration is enabled.

Node.js 22.23.2, npm 10.9.8, and an FFmpeg installation with `libopus` are required only for native
development. PostgreSQL, Ollama, faster-whisper, Python, Node, and FFmpeg are prepared automatically
by the Docker workflow.

## Local setup

1. Run `./summyz-community up` on Linux or macOS, or `.\summyz-community.ps1 up` on Windows. On
   first use, the launcher creates `.env` with random local secrets without printing their values.
2. The host launcher detects
   CPU, NVIDIA, or AMD, selects the safe Compose overlays, and starts the complete stack.
3. The launcher opens a private setup URL. Enter only the Discord bot token. Summyz validates it
   with Discord and derives the Application ID automatically. In public mode, also choose the
   installation-wide dashboard password. OpenRouter and AI profiles are configured later.
4. For development, set `DISCORD_GUILD_ID` to the test server ID. Without this variable, commands
   are registered globally and may take some time to appear.

Use `./summyz-community status`, `./summyz-community logs`, `./summyz-community restart`, and
`./summyz-community down` to administer the stack; use `.\summyz-community.ps1` instead on Windows.
Public-mode password recovery requires host access: `recover-access` creates a single-use URL that
expires after ten minutes. Local mode has no dashboard authentication. There are no Summyz user
accounts, public registration, email delivery, or Discord user OAuth in Community.
Direct Compose remains available for advanced use. The base `docker compose up -d --build` command
uses CPU. For NVIDIA, run
`docker compose -f compose.yaml -f docker/compose.nvidia.yaml up -d --build`; for AMD, replace the
NVIDIA overlay with `docker/compose.amd.yaml`.

For native development, run `npm install` and configure an absolute `FFMPEG_PATH` or make
`ffmpeg`/`ffmpeg.exe` available through `PATH`. The bot validates FFmpeg and `libopus` before
connecting to Discord. Supporting services can remain in Compose. For the interface, run
`npm run dev:api` and `npm run dev:web` in separate terminals.

If local port `5432` is already in use, change `POSTGRES_PORT` and adjust the port in
`DATABASE_URL`. PostgreSQL is exposed only on `127.0.0.1`; the connection between containers
continues to use `postgres:5432`.

For a public VPS installation, set an HTTPS origin in `PUBLIC_BASE_URL` inside `.env`, point the
domain to the host, and use `./summyz-community-public up` or
`.\summyz-community-public.ps1 up`. This optional mode adds Caddy for automatic TLS. The local
launcher does not expose the dashboard publicly. If `.env` does not exist yet, the public launcher
creates it and asks the operator to set the HTTPS origin before running the command again.
During public setup, choose an installation password between 15 and 128 characters. It is Unicode
NFC-normalized and stored only as an Argon2id hash. Session cookies are `HttpOnly`, `Secure`, and
`SameSite=Strict`, with seven idle days and a thirty-day absolute lifetime.

Never commit the `.env` file or publish the bot token or the private setup URL.

Migrations and the PostgreSQL connection are validated before the bot connects to Discord; if the database
is unavailable or the URL is invalid, the process exits with a safe message. The
`postgres_data` and `summyz_community_data` volumes preserve the database and required files across
restarts.

## Documentation

- [Installation](./docs/installation.md)
- [Configuration](./docs/configuration.md)
- [Operations, privacy, and publishing](./docs/operations.md)
- [Development and quality](./docs/development.md)
- [Bot command reference](./docs/reference/bot-commands.md)
- [Release checklist](./docs/release-checklist.md)
- [Security policy](./SECURITY.md)

The [pt-BR documentation](./docs/pt-BR/README.md) is maintained alongside these English sources.

## Contributing

Individual contributions are welcome. Corporate contributions are not currently
accepted.

1. Fork the repo and create a feature branch.
2. Keep modules small and single-purpose; follow the existing structure.
3. Add tests for new logic — `npm test` must pass.
4. Read and accept the Individual CLA and create the public acceptance record.
5. Open a pull request describing the change and the reasoning.

See [CONTRIBUTING.md](./CONTRIBUTING.md) and
[CLA-INDIVIDUAL.md](./docs/legal/CLA-INDIVIDUAL.md). For bugs and feature requests, please open an
issue.

The complete setup guide is in [docs/installation.md](./docs/installation.md). Release
maintainers must also follow [docs/release-checklist.md](./docs/release-checklist.md).

## License

Summyz Community is source-available software under the
[Summyz Community License 1.0](./LICENSE.md). It permits personal use, free internal
business use, free external availability under its conditions, and paid administration
of customer-controlled infrastructure within the stated exception. It does not permit
selling the bot, charging for its services or configuration, or offering monetized
hosted access.

This is not an Open Source Initiative-approved open-source license. The names and Brand
Assets are governed by the [trademark policy](./TRADEMARKS.md), and Third-Party
Materials retain their own terms. See [NOTICE.md](./NOTICE.md) and
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
