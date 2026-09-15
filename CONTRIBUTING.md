# Contributing to Summyz Community

Thank you for contributing. Read this document, `AGENTS.md`, the Summyz Community
License 1.0, and the Individual Contributor License Agreement before opening a pull
request.

Portuguese: [docs/pt-BR/CONTRIBUTING.md](./docs/pt-BR/CONTRIBUTING.md)

## Development workflow

1. Fork the repository and create a focused branch.
2. Follow the architecture, security, privacy, naming, and strict TDD requirements in
   `AGENTS.md`.
3. Add or update tests before implementing behavior changes.
4. Run `npm run check`.
5. Describe the motivation, behavior, risks, and validation in the pull request.

Do not include secrets, credentials, personal meeting content, raw audio, private
transcripts, confidential information, or material You are not authorized to disclose.
Identify all third-party code or assets and their licenses.

## Individual CLA required

Only individual Contributions are accepted at this time. Every human contributor must
accept [Summyz Individual Contributor License Agreement 1.0](./docs/legal/CLA-INDIVIDUAL.md).
Corporate Contributions are not accepted until the Project Owner publishes a private
corporate intake procedure. The corporate agreement in
[`docs/legal/CLA-CORPORATE.md`](./docs/legal/CLA-CORPORATE.md) is currently
a template only.

Do not submit a Contribution if an employer, client, educational institution, or other
organization may own it or prevent You from granting the Individual CLA.

Before Your first pull request, create the public acceptance record with:

```bash
npm run cla:sign -- --name "Your Full Legal Name" --login "your-github-login"
```

Review and commit the generated file with the pull request. In every pull request,
provide the same legal name and check the CLA acceptance statement inserted by
`.github/pull_request_template.md`. The legal name and minimal acceptance metadata are
public. No address, government identifier, or email is requested.

The exact acceptance statement is:

> I have read and agree to the Summyz Individual Contributor License Agreement 1.0. I
> am contributing as an individual and have the right to license my Contribution.

The repository's read-only CLA workflow validates the pull request author, commit
authors, acceptance record, and exact statements. It rejects co-authored or unlinked
commits and prevents a pull request from changing another contributor's record. The
record contains only the fields listed in the Individual CLA. The repository owner and
explicitly recognized dependency bots do not need to sign an agreement with themselves.

The CLA applies to all Contributions You intentionally submit after accepting it. The
pull-request check runs again when the pull request body or commits change, and the
GitHub pull request and merge history tie the public record to the reviewed commits.

## Review and licensing

Submitting a Contribution does not guarantee acceptance. Accepted Contributions may be
modified, rejected, or removed. You retain ownership of Your original Contribution
while granting the rights stated in the Individual CLA, including the right for the
Project Owner to use it in public, commercial, proprietary, and hosted Summyz versions.

Summyz Community is source-available, not OSI-approved open source. Do not describe the
license or project as open source.

For bugs and feature requests that do not include a Contribution, open an issue.
