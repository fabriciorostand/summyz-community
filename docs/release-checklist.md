# Release checklist

[Português](./pt-BR/release-checklist.md) · [Documentation home](../README.md)

This checklist is prepared for 1.0.0 but must be executed again from the exact final
commit. Completing preparation is not authorization to publish a tag or GitHub release.

## Scope and repository

- [ ] Confirm the intended commit and version in every `package.json`.
- [ ] Confirm the tree is clean and the branch contains only reviewed changes.
- [ ] Confirm public documentation consistently says **source-available**, not open source.
- [ ] Review `LICENSE.md`, `NOTICE.md`, `TRADEMARKS.md`, CLAs, contribution policy, and
      `THIRD_PARTY_NOTICES.md` together.
- [ ] Confirm no tag or release named `1.0.0` already exists.

## Reproducibility and dependencies

- [ ] Run `npm ci` from a clean checkout.
- [ ] Recompile `requirements.lock` only when intentionally updating Python packages;
      review every diff and hash.
- [ ] Verify every external Docker reference still has the approved version and digest.
- [ ] Build the bot, dashboard, faster-whisper CPU, and faster-whisper CUDA release tags
      listed in `scripts/release/sbom-targets.json`.

  ```console
  docker build --file docker/Dockerfile --target bot-runtime --tag summyz-community-bot:release .
  docker build --file docker/Dockerfile --target dashboard-runtime --tag summyz-community-dashboard:release .
  docker build --file services/faster-whisper/Dockerfile --target cpu --tag summyz-community-faster-whisper:release-cpu .
  docker build --file services/faster-whisper/Dockerfile --target cuda --tag summyz-community-faster-whisper:release-cuda .
  ```

- [ ] Confirm FFmpeg reports LGPL 2.1-or-later, the recorded checksum matches its source
      archive, and no GPL/nonfree configure option is enabled.

## Tests and security

- [ ] Run `npm run check`.
- [ ] Run `npm run build`.
- [ ] Run `npm run security:audit` and a Python audit against `requirements.lock`.
- [ ] Scan every exact release image with an up-to-date vulnerability database; resolve,
      justify, or document every high or critical finding.
- [ ] Run the local-AI smoke suite for every available hardware path.
- [ ] Record untested OS/GPU combinations in release notes without silently removing
      support.
- [ ] Run Gitleaks against the working tree and the complete Git history.
- [ ] Manually inspect staged files, `.env.example`, logs, screenshots, fixtures, and Git
      identities for credentials or personal data.

## Legal evidence and SBOM

- [ ] Inspect upstream release notes and terms for Docker bases, PostgreSQL, Ollama,
      NVIDIA CUDA/cuDNN, and AMD ROCm.
- [ ] Review selected default model identifiers and their current upstream terms. Models
      are not bundled, and arbitrary models remain the operator's responsibility.
- [ ] From the clean final commit, run `npm run release:sbom`.
- [ ] Verify all CycloneDX and SPDX files parse successfully.
- [ ] Verify `manifest.json` names the final commit and says `"dirty": false`.
- [ ] Verify every line in `SHA256SUMS` against the generated files.
- [ ] Review SBOM license findings against `THIRD_PARTY_NOTICES.md`; update notices before
      tagging if the artifacts differ.

## Publication — deferred to the release stage

- [ ] Make the repository public only after the owner approves the final diff.
- [ ] Configure branch protection and required checks.
- [ ] Create a signed or verified annotated tag `1.0.0` from the approved commit.
- [ ] Create the GitHub release from that tag with release notes, known validation gaps,
      source archives, all SBOM documents, `manifest.json`, and `SHA256SUMS`.
- [ ] Download the published assets and independently verify their checksums.
- [ ] Perform a clean installation using only the public release instructions.
- [ ] Document rollback or withdrawal steps before announcing the release.
