# Installation

[Português](./pt-BR/installation.md) · [Documentation home](../README.md)

This guide installs Summyz Community from source. The project does not publish prebuilt Summyz
images for version 1.0.0.

## Requirements and supported hosts

Install Git and Docker with the Compose plugin. Prepare a Discord bot application and the Discord
account that owns the servers to be configured. OpenRouter credits are required only for stages
that use OpenRouter. GPU execution also requires compatible host drivers and Docker integration.

| Host | CPU | NVIDIA CUDA | AMD ROCm | Validation during 1.0.0 preparation |
| --- | --- | --- | --- | --- |
| Windows with Docker Desktop/WSL2 | Supported | Supported | Not exposed by Docker Desktop | NVIDIA validated on an RTX 2060; CPU build validated |
| Linux with Docker Engine + Compose | Supported | Supported | Supported for Ollama | Physical-host validation remains pending |
| macOS with Docker Desktop | Supported | Not applicable | Not applicable | Physical-host validation remains pending |

Pending validation records the available evidence, rather than changing the support status.
faster-whisper GPU transcription supports NVIDIA/CUDA; AMD ROCm supports Ollama on Linux.
See [execution settings](./configuration.md#local-execution-and-vad) before choosing a local profile.

## Prepare the Discord application

1. Create or select the bot application in the Discord Developer Portal.
2. Under **Bot**, obtain its token and enable **Server Members Intent** for member lists and counts.
3. Under **Installation**, enable **Guild Install** with `bot` and `applications.commands` scopes.
   Configure the [bot permissions](./configuration.md#forum-and-recording-authorizations).
4. Under **OAuth2**, obtain the application's **Client Secret** and register the exact redirect URL
   `<PUBLIC_BASE_URL>/api/discord/callback`. With the default local origin, it is
   `http://127.0.0.1:8787/api/discord/callback`; public installations use their configured HTTPS origin.

The bot token authenticates the bot. The Client Secret allows Summyz to connect the server owner's
Discord account. Keep both private and configure them as installation credentials.

## Start a local installation

Clone the repository and run from its root:

```sh
./summyz-community up
```

On Windows PowerShell:

```powershell
.\summyz-community.ps1 up
```

On the first `up` or `restart`, the launcher copies `.env.example` to `.env` and generates random
PostgreSQL, encryption, and setup secrets without printing their values. Preserve this file:
replacing `SUMMYZ_SECRETS_KEY` makes encrypted stored credentials unreadable.

The launcher detects hardware on the host and selects the Compose overlays before starting the
containers. It never mounts the Docker socket into the application. If requested GPU execution is
unavailable, startup stops unless `LOCAL_AI_FALLBACK=cpu` was explicitly configured. The dashboard
and PostgreSQL bind to `127.0.0.1`; local dashboard access requires no password.

The local launcher opens the setup URL on Windows or opens/prints it on Linux/macOS according to
browser availability. Its fragment carries the setup claim; do not share it.

## Start a public installation

Set `PUBLIC_BASE_URL` in `.env` to the exact HTTPS origin, point DNS to the host, and run:

```sh
./summyz-community-public up
```

On Windows, use `.\summyz-community-public.ps1 up`. If `.env` is missing, the public launcher creates
it and exits so you can configure the origin before running it again. This mode adds Caddy,
publishes ports 80/443, and obtains TLS certificates automatically. Keep PostgreSQL private;
firewall and cloud security-group configuration belong to the operator.

Register the HTTPS OAuth callback for this origin in the Discord application. Public setup also
requires an installation password of 15–128 characters. See
[access and recovery](./operations.md#installation-access-and-password-recovery) for session and
password recovery behavior.

## First access and first recording

1. Complete setup with the bot token and, in public mode, the installation password. Summyz
   validates the token with Discord and derives the Application ID automatically.
2. Configure the application's Client Secret and connect the server owner's Discord account.
   Setup offers an optional Client Secret step and shows the redirect URL to register; the
   **Installation** screen does the same later. Authorize the `identify guilds` scopes. In public
   mode, sign in again after completing the connection because previous dashboard sessions are
   revoked; the dashboard then returns to **Servers** with the outcome.
3. Install the bot in a server owned by the connected account. Configure its publication forum
   and the roles or individual members allowed to record.
4. Complete the initial AI profile by selecting a provider and model for transcription, refinement,
   and summary. Configure the OpenRouter key if any stage uses it; install local models as needed.
5. Activate the profile for the server. Join a standard voice channel and run `/record`. Use `/stop`
   in the same channel; recording also ends when everyone leaves.

New installations start with one incomplete profile and no active profile per server. A configured
forum, complete profile, available local models, and verified ownership are required before recording.
After an ownership change, the new connected owner must review the configuration and confirm it with
`/recording-activate` or the server activation flow. See [configuration](./configuration.md) and
[commands](./reference/bot-commands.md) for details.

## Direct Compose and native development

Advanced operators can supply a complete `.env` and choose overlays explicitly:

```sh
docker compose up -d --build
docker compose -f compose.yaml -f docker/compose.nvidia.yaml up -d --build
docker compose -f compose.yaml -f docker/compose.amd.yaml up -d --build
```

These are alternative launch commands: the base configuration uses CPU, while NVIDIA and AMD select
their respective overlays. AMD acceleration is available only on Linux.

Native development requires Node.js 22.23.2, npm 10.9.8, and FFmpeg with `libopus`. Configure an
absolute `FFMPEG_PATH` or make `ffmpeg`/`ffmpeg.exe` available through `PATH`. See the
[development guide](./development.md) for scripts, database connections, and local-service networking.

## Administration and data

Use the launcher for `status`, `logs`, `restart`, and `down`. See [operations](./operations.md) for
recovery, credential replacement, backups, and retention. Named volumes preserve the database,
recordings, and model caches; `down` does not delete them.

Review [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before selecting models or redistributing
locally built images. Never publish `.env`, recordings, transcripts, or database dumps.
