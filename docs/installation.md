# Installation

This guide installs Summyz Community from source. The project does not publish prebuilt
Summyz images for version 1.0.0.

## Supported launch paths

| Host | CPU | NVIDIA CUDA | AMD ROCm | Validation status for 1.0.0 preparation |
| --- | --- | --- | --- | --- |
| Windows with Docker Desktop/WSL2 | Supported | Supported | Not exposed by Docker Desktop | NVIDIA validated on an RTX 2060; CPU build validated |
| Linux with Docker Engine + Compose | Supported | Supported | Supported | Launch paths retained; physical-host validation remains pending |
| macOS with Docker Desktop | Supported | Not applicable | Not applicable | Launch path retained; physical-host validation remains pending |

“Pending validation” is not an experimental feature label. It records the test evidence
available for this release candidate. Hardware must also be supported by the installed
driver, Docker integration, CUDA, or ROCm version.

## Requirements

- Git;
- Docker with the Compose plugin;
- a Discord bot application;
- compatible host GPU drivers and Docker integration when acceleration is requested;
- optional OpenRouter account and credits only for profile stages that use OpenRouter.

## Start the stack

Clone the repository and run from its root:

```sh
./summyz-community up
```

On Windows PowerShell:

```powershell
.\summyz-community.ps1 up
```

On the first `up` or `restart`, the launcher copies `.env.example` to `.env` and creates
random PostgreSQL, encryption, and setup secrets. It prints no secret values. Preserve
that file privately; replacing `SUMMYZ_SECRETS_KEY` makes encrypted stored credentials
unreadable.

The launcher detects CPU, NVIDIA, or AMD before entering the containers and selects the
corresponding Compose overlay. It never mounts the Docker socket into the application.
AMD ROCm acceleration is available only on Linux. If an explicitly requested GPU is not
usable, startup stops unless `LOCAL_AI_FALLBACK=cpu` was deliberately configured.

Open `http://127.0.0.1:8787` and complete the one-time setup. Configure Discord, SMTP,
optional OpenRouter credentials, a personal AI profile, and a publication forum.

## Administration

```sh
./summyz-community status
./summyz-community logs
./summyz-community restart
./summyz-community down
```

Use the `.ps1` launcher on Windows. Direct Compose is retained for advanced operators,
but they must choose the correct overlay and provide a complete `.env` themselves.

PostgreSQL and dashboard ports bind to `127.0.0.1` by default. For a VPS, place an HTTPS
reverse proxy in front of the dashboard, set `PUBLIC_BASE_URL` to the public HTTPS origin,
and do not expose PostgreSQL publicly.

## Native development

Install Node.js 22.12 or later, npm, and FFmpeg with libopus on the host. Set an absolute
`FFMPEG_PATH` or place `ffmpeg`/`ffmpeg.exe` in `PATH`. Then run `npm install` and the
desired development scripts. Python, PostgreSQL, Ollama, and faster-whisper can remain in
Docker.

The controlled LGPL FFmpeg build is automatic only inside Docker. Native developers are
responsible for the license and codec configuration of their locally installed FFmpeg.

## Data and backups

Named volumes preserve PostgreSQL, model caches, and Summyz data. `down` does not delete
them; do not add `--volumes` unless permanent deletion is intended. Back up PostgreSQL,
the Summyz data volume, and `.env` together. Never publish `.env`, raw recordings, full
transcripts, database dumps, or model caches.

Review [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) before selecting models or
redistributing any locally built image.
