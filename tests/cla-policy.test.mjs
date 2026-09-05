import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSignature } from "../scripts/cla/create-signature.mjs";
import {
  ACCEPTANCE_TEXT,
  AUTHORSHIP_TEXT,
  signaturePathFor,
  validatePullRequestAcceptance,
  validateSignatureRecord,
} from "../scripts/cla/policy.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function bodyFor(name = "João da Silva") {
  return [
    `CLA legal name: ${name}`,
    "",
    `- [x] ${ACCEPTANCE_TEXT}`,
    "",
    `- [x] ${AUTHORSHIP_TEXT}`,
  ].join("\n");
}

function commitFor(login = "contributor", message = "feat(core): add feature") {
  return { author: { login }, commit: { message } };
}

describe("individual CLA policy", () => {
  it("accepts a single linked individual author", () => {
    expect(
      validatePullRequestAcceptance({
        body: bodyFor("Érica D'Ávila"),
        pullRequestLogin: "contributor",
        commits: [commitFor()],
      }),
    ).toBe("Érica D'Ávila");
  });

  it("rejects an unchecked acceptance statement", () => {
    expect(() =>
      validatePullRequestAcceptance({
        body: bodyFor().replace(`- [x] ${ACCEPTANCE_TEXT}`, `- [ ] ${ACCEPTANCE_TEXT}`),
        pullRequestLogin: "contributor",
        commits: [commitFor()],
      }),
    ).toThrow("Accept the exact Individual CLA");
  });

  it("rejects a commit linked to another account", () => {
    expect(() =>
      validatePullRequestAcceptance({
        body: bodyFor(),
        pullRequestLogin: "contributor",
        commits: [commitFor("another-author")],
      }),
    ).toThrow("Every commit must be linked to @contributor");
  });

  it("rejects co-authored commits", () => {
    expect(() =>
      validatePullRequestAcceptance({
        body: bodyFor(),
        pullRequestLogin: "contributor",
        commits: [commitFor("contributor", "feat(core): work\n\nCo-authored-by: Other <x@y.z>")],
      }),
    ).toThrow("Co-authored commits are not accepted");
  });

  it("validates the public signature record", () => {
    expect(
      validateSignatureRecord(
        {
          agreement: "Summyz Individual Contributor License Agreement",
          claVersion: "1.0",
          legalName: "João da Silva",
          githubLogin: "Contributor",
          acceptedAt: "2026-09-05T12:00:00.000Z",
          acceptanceText: ACCEPTANCE_TEXT,
        },
        { legalName: "João da Silva", githubLogin: "contributor" },
      ),
    ).toEqual({
      legalName: "João da Silva",
      githubLogin: "Contributor",
      acceptedAt: "2026-09-05T12:00:00.000Z",
    });
  });

  it("rejects additional personal data in the public signature record", () => {
    expect(() =>
      validateSignatureRecord(
        {
          agreement: "Summyz Individual Contributor License Agreement",
          claVersion: "1.0",
          legalName: "João da Silva",
          githubLogin: "Contributor",
          acceptedAt: "2026-09-05T12:00:00.000Z",
          acceptanceText: ACCEPTANCE_TEXT,
          email: "private@example.com",
        },
        { legalName: "João da Silva", githubLogin: "contributor" },
      ),
    ).toThrow("fields that must not be public");
  });

  it("creates a non-overwriting signature file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "summyz-cla-"));
    temporaryDirectories.push(directory);
    const relativePath = await createSignature({
      legalName: "João da Silva",
      githubLogin: "Contributor",
      rootDirectory: directory,
      now: new Date("2026-09-05T12:00:00.000Z"),
    });

    expect(relativePath).toBe(signaturePathFor("Contributor"));
    const record = JSON.parse(await readFile(join(directory, relativePath), "utf8"));
    expect(record).toMatchObject({
      legalName: "João da Silva",
      githubLogin: "Contributor",
      claVersion: "1.0",
    });
    await expect(
      createSignature({
        legalName: "João da Silva",
        githubLogin: "Contributor",
        rootDirectory: directory,
        now: new Date("2026-09-05T12:00:00.000Z"),
      }),
    ).rejects.toThrow("Signature already exists");
  });
});
