# Development and quality

[Português](./pt-BR/development.md) · [Documentation home](../README.md)

## Quality

Run `npm run check` before submitting changes. This command validates formatting, linting, types,
tests, and coverage. Run `npm run security:audit` to check dependencies.

The MVP's Opus decoder is `opusscript`, avoiding the vulnerable dependency chain found in the
native dependency that was evaluated. The local-service smoke test is automated inside the private
Compose network with `docker compose --profile smoke run --rm smoke`; it downloads small models and
may take a while on its first run. Real Discord interactions are not presented as automated tests.

The faster-whisper benchmark uses `transcript.raw.txt` as its reference, calculates WER, CER,
elapsed time, and real-time factor, and does not include meeting content in its report. Configure
`BENCHMARK_DEVICE`, `BENCHMARK_BATCH_SIZE`, and `BENCHMARK_MODEL`, then run
`docker compose --profile benchmark run --rm benchmark`. It measures only meetings that still have
all their audio files.

## Continuous integration

The `CI` workflow runs for pull requests targeting `main` and pushes to `main`. It exposes the
blocking `Quality`, `Security`, `Tests`, and `Runtime / Images` gates, followed by the aggregate
`Quality Gate`. A new commit cancels the previous run for the same pull request; pushes to `main`
remain in one queue and do not cancel earlier runs.

Server tests always use a real PostgreSQL 18.4 instance. The server, dashboard, and Python service
must each reach at least 85% global line coverage and 85% in every domain group. Coverage on new or
modified code is calculated once as a line-weighted aggregate across all three components and must
also reach 85%. HTML, JUnit, JSON, and SARIF reports are retained as artifacts in addition to the
run summary. Internal pull requests receive one persistent, fully English Quality Gate comment that
is updated on every run; fork pull requests receive the same checks, summary, and artifacts without
exposing secrets or granting write permission.

The Security measure counts only unique fixable `HIGH` or `CRITICAL` vulnerabilities. Those
findings block the gate. Lower-severity findings and vulnerabilities for which no fix has been
published do not contribute to the measure and do not block the gate, but remain visible alongside
quality and security diagnostics under **Issue details** and in the complete artifacts.

The runtime gate builds the bot, dashboard, CPU faster-whisper, and NVIDIA packaging images,
validates the Compose variants, and performs real local inference on CPU with verified model
revisions. Execution on an actual GPU remains outside this workflow. Node.js 22.23.2, npm 10.9.8,
Python 3.12.14, base images, actions, lock files, and Debian repository snapshots are pinned. The
NVIDIA image resolves its Ubuntu system packages from the official HTTPS repositories at build
time so superseded security updates do not make the image unbuildable; the image vulnerability
scan remains authoritative for fixable `HIGH` or `CRITICAL` findings.
The `ubuntu-24.04` runner and scanner vulnerability databases remain services updated by GitHub and
their vendors. npm, pip, BuildKit, and model caches make later runs faster without skipping version,
hash, and digest checks.
