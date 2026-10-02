# Development and quality

[Português](./pt-BR/development.md) · [Documentation home](../README.md)

## Environment and commands

Use Node.js 22.23.2 and npm 10.9.8, as pinned in `package.json` and CI. Docker prepares these runtimes,
Python 3.12.14, and the controlled LGPL FFmpeg build. Native execution needs FFmpeg with `libopus`:
set an absolute `FFMPEG_PATH` or place `ffmpeg`/`ffmpeg.exe` in `PATH`. The bot validates it before
connecting to Discord. Native developers are responsible for their FFmpeg license and codecs.

Install locked dependencies from the repository root:

```sh
npm ci
```

Prepare `.env` through the [installation workflow](./installation.md). Do not commit it. For native
database access, change the launcher's Compose `DATABASE_URL` from `postgres:5432` to the host address
and published `POSTGRES_PORT`.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Supervised bot in development |
| `npm run dev:api:local` / `npm run dev:api:public` | Dashboard API |
| `npm run dev:web` | Vite dashboard at `127.0.0.1:5173`, proxying `/api` to `127.0.0.1:8787` |
| `npm run build` | Build server and dashboard |
| `npm start` | Compiled supervised bot |
| `npm run api:local` / `npm run api:public` | Compiled dashboard API |

Run bot, API, and Vite in separate terminals as needed. Vite is the browser origin during frontend
development, while `PUBLIC_BASE_URL` determines the Discord OAuth callback origin; register that
exact callback in the Discord application.

The script selects access mode with `--access-mode local` or `--access-mode public`. The mode is
not read from `.env`; a legacy `DASHBOARD_ACCESS_MODE` entry is ignored. Without an argument, the
API defaults to local mode. In Docker, the launcher selects the corresponding API command.

`WEB_HOST` controls the native API listener and Docker's dashboard port publication address. The
internal container listener remains `0.0.0.0:8787`. Changing the host does not change authentication,
accepted Host headers, or trusted origins. Use `WEB_HOST=127.0.0.1` in local mode, which requires
no password. Check this shared value when switching scripts.

Public npm scripts require an HTTPS `PUBLIC_BASE_URL` and a non-loopback `WEB_HOST`, such as
`0.0.0.0`. They do not start Caddy or configure certificates; prepare the HTTPS proxy before using
this mode. The public Docker launcher provides Caddy automatically.

Local AI clients use `http://ollama:11434` and `http://faster-whisper:8000`. Those service names resolve
inside Compose, and the base stack does not publish their ports to the host. Native local-AI work
therefore needs deliberate service networking and name resolution; simply running the private
services in Compose does not make those URLs reachable from a native process. The Compose workflow
provides the shared network automatically.

## Project structure and conventions

- `src/discord`, `src/recording`: commands, ownership, voice capture, manifests, and recovery;
- `src/transcription`, `src/refinement`, `src/summary`, `src/processing`: validated stages and durable jobs;
- `src/models`, `src/local-ai`, `src/openrouter`, `src/cost`: catalogs, model lifecycle, execution, and costs;
- `src/api`, `src/auth`, `src/database`: dashboard contracts, installation access, persistence, and migrations;
- `web/src`: React routes, screens, browser preferences, and English/pt-BR messages;
- `services/faster-whisper`: Python transcription service;
- `tests`, `web/src/**/*.test.*`, `scripts/ci`: tests and quality gates.

Follow [AGENTS.md](../AGENTS.md). TypeScript is strict; validate external data, model optional states,
and handle rejections and resource lifecycles explicitly. Use English code/database identifiers and
comments. Keep secrets, authorization headers, and audio content out of logs; Discord errors must
not expose internals. Tests include assertions that fail when credentials leak into logs.

## TDD and local quality checks

For logic changes, use Vitest in red-green-refactor order: write the failing test, implement the
minimum, then refactor. Isolate replaceable integrations at actual boundaries. Automated local-AI
smoke tests are separate from the fast suite; real manual Discord interactions are not automated
acceptance criteria.

```sh
npm run check
npm run security:audit
```

`check` runs Biome checks, server and web typechecks, Python unit tests, server coverage, and web
tests. Use these scripts separately when diagnosing a failure:

| Command | Check |
| --- | --- |
| `npm test` | Server fast suite, including configured database integrations |
| `npm run test:coverage` | Server coverage; 85% thresholds for lines, branches, functions, and statements |
| `npm run test:web` / `npm run test:web:coverage` | Dashboard tests / CI coverage configuration |
| `npm run test:python` / `npm run test:python:coverage` | Python unit tests / coverage and reports |
| `npm run typecheck` / `npm run typecheck:web` | Server / dashboard types |
| `npm run lint` / `npm run format:check` | Lint / formatting checks |
| `npm run format` | Apply formatting |

Python coverage needs the tools in `requirements/ci.lock`; the unit script uses `unittest`.
`check` does not run the dashboard coverage gate, domain coverage, or local-AI smoke. CI also uses
broader server coverage inclusion than the local configuration.

## PostgreSQL integration tests

Local integration suites use `POSTGRES_TEST_URL` and are skipped when it is absent. Point it to a
dedicated disposable PostgreSQL database, never the running installation or a backup: migration
tests recreate schema and fixtures. CI supplies a real PostgreSQL 18.4 instance and runs those suites.

To reproduce the broader CI server coverage configuration with that test database configured:

```sh
npm run test:coverage:ci
```

## Local-AI smoke and transcription benchmark

With the Docker stack configured, run the isolated smoke suite on its private network:

```sh
docker compose --profile smoke run --rm smoke
```

It performs real local inference, downloads small models, and can take longer on first use.
`npm run test:smoke:local-ai` is the isolated Vitest entry point; the Compose command supplies the
service network and runtime. Choose appropriate GPU overlays when explicitly testing acceleration.
CI inference runs on CPU; building CUDA packaging is not validation on a physical GPU.

The benchmark uses retained audio and `transcript.raw.txt` as the reference and reports WER, CER,
elapsed time, and real-time factor without meeting content. The default benchmark mounts host
`./data` read-only, rather than the bot's named data volume. Supply a read-only mount of the intended
retained recording directory when benchmarking Docker recordings.

```sh
docker compose --profile benchmark run --rm -e BENCHMARK_DEVICE -e BENCHMARK_BATCH_SIZE -e BENCHMARK_MODEL benchmark
```

Set those host variables before the command. `BENCHMARK_DATA_DIR` is the directory inside the
benchmark container (`/benchmark-data/recordings` by default). Only meetings with all audio files
remaining are measured.
The dataset also needs `manifest.json` and `transcript.raw.txt` for each meeting. Terminal cleanup
removes those local files even when audio is retained; prepare an isolated read-only dataset from
preserved content and audio rather than assuming the terminal recording directory is complete.

## Migrations and upgrade preservation

Migrations are ordered TypeScript SQL definitions under `src/database/migrations*.ts`.
Applied migrations are immutable: PostgreSQL records a SHA-256 checksum, and startup fails closed
if the checked-in SQL differs. Do not repair an applied migration by editing its historical SQL.

From version 10 onward, migrations must be expand-only: no business-data deletion, truncation,
table/column drops, cascading deletion, or meeting-processing data updates. Cleanup belongs to
the explicit retention lifecycle after a terminal state. Initialization must preserve pending artifacts.
Processing/manifest schema upgrades require contract tests proving that meetings, jobs, cost attempts,
manifests, and audio catalogs survive and remain recoverable. See the upgrade integration tests and
`tests/database-migration-safety.test.ts`.

## Continuous integration

`CI` runs for PRs targeting `main` and pushes to `main`. Jobs are `Quality`, `Security`, `Tests`,
`Runtime / Images`, `Quality Gate / Analysis`, and `Quality Gate`. New commits cancel older runs
for the same PR; pushes to `main` do not cancel one another. Branch protection determines whether
direct pushes are blocked.

Server, dashboard, and Python each need at least 85% global line coverage and 85% in every domain
group. Changed-code coverage is one line-weighted aggregate across the three components, also at
least 85%. HTML, JUnit, JSON, and SARIF reports are retained as artifacts. Internal PRs receive one
persistent English Quality Gate comment; fork PRs receive checks, summary, and artifacts without
secrets or write access. Analysis collects results and stores the main baseline after pushes.

Security counts unique fixable HIGH/CRITICAL vulnerabilities as blocking findings. Lower severities
and findings without a published fix remain visible in issue details and artifacts. Secret and
misconfiguration checks have their own enforcement in the workflow.

The runtime job builds bot, dashboard, and CPU transcription images, validates users/runtime
versions and Compose variants, and scans those images. On pushes to `main`, local-AI CPU inference
and CUDA packaging always run. On PRs, transcription service, FFmpeg, dependency-lock, or workflow
changes select both; changes in smoke/runtime/model dependencies select local-AI smoke; unrelated
changes can skip both. The workflow's path filters are the source of truth for this selection.

Node.js 22.23.2, npm 10.9.8, Python 3.12.14, image digests, actions, package locks, and Debian
snapshots are pinned. NVIDIA system packages are retrieved from official HTTPS Ubuntu repositories
at build time. The GitHub runner and scanner vulnerability databases remain updated services.
npm, pip, BuildKit, and verified model caches speed later runs; the dashboard reads the bot build
cache without replacing it. New model cache entries are saved only after successful smoke on main.
