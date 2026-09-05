import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  signaturePathFor,
  validatePullRequestAcceptance,
  validateSignatureRecord,
} from "./policy.mjs";

const BYPASSED_LOGINS = new Set(["dependabot[bot]"]);

function requireObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "summyz-community-cla-check",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API request failed with HTTP ${response.status}.`);
  }
  return response.json();
}

async function fetchAll(url, token) {
  const values = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const data = await githubJson(`${url}${separator}per_page=100&page=${page}`, token);
    if (!Array.isArray(data)) {
      throw new Error("GitHub returned an invalid paginated response.");
    }
    values.push(...data);
    if (data.length < 100) {
      return values;
    }
  }
  throw new Error("Pull request is too large for CLA validation.");
}

async function fetchSignature(repositoryUrl, path, headSha, token) {
  const encodedPath = path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  const data = requireObject(
    await githubJson(
      `${repositoryUrl}/contents/${encodedPath}?ref=${encodeURIComponent(headSha)}`,
      token,
    ),
    "signature response",
  );
  if (data.encoding !== "base64") {
    throw new Error("CLA signature file must be returned as base64 content.");
  }
  const content = requireString(data.content, "signature content").replaceAll("\n", "");
  return JSON.parse(Buffer.from(content, "base64").toString("utf8"));
}

async function main() {
  const eventPath = requireString(process.env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH");
  const token = requireString(process.env.GITHUB_TOKEN, "GITHUB_TOKEN");
  const event = requireObject(JSON.parse(await readFile(eventPath, "utf8")), "GitHub event");
  const pullRequest = requireObject(event.pull_request, "pull_request");
  const user = requireObject(pullRequest.user, "pull_request.user");
  const repository = requireObject(event.repository, "repository");
  const owner = requireObject(repository.owner, "repository.owner");
  const head = requireObject(pullRequest.head, "pull_request.head");
  const headRepository = requireObject(head.repo, "pull_request.head.repo");
  const login = requireString(user.login, "pull_request.user.login");
  const ownerLogin = requireString(owner.login, "repository.owner.login");

  if (login.toLowerCase() === ownerLogin.toLowerCase() || BYPASSED_LOGINS.has(login)) {
    process.stdout.write(`CLA check bypassed for @${login}.\n`);
    return;
  }

  const commits = await fetchAll(
    requireString(pullRequest.commits_url, "pull_request.commits_url"),
    token,
  );
  const legalName = validatePullRequestAcceptance({
    body: typeof pullRequest.body === "string" ? pullRequest.body : "",
    pullRequestLogin: login,
    commits,
  });

  const expectedSignaturePath = signaturePathFor(login);
  const files = await fetchAll(
    `${requireString(pullRequest.url, "pull_request.url")}/files`,
    token,
  );
  for (const fileValue of files) {
    const file = requireObject(fileValue, "pull request file");
    const filename = requireString(file.filename, "pull request filename");
    if (filename.startsWith(".cla/signatures/") && filename !== expectedSignaturePath) {
      throw new Error("A pull request may not modify another contributor's CLA record.");
    }
  }

  const signature = await fetchSignature(
    requireString(headRepository.url, "pull_request.head.repo.url"),
    expectedSignaturePath,
    requireString(head.sha, "pull_request.head.sha"),
    token,
  );
  validateSignatureRecord(signature, { legalName, githubLogin: login });
  process.stdout.write(`Individual CLA 1.0 validated for @${login}.\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown CLA check failure.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
