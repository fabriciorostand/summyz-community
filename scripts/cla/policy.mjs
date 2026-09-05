export const CLA_VERSION = "1.0";
export const ACCEPTANCE_TEXT =
  "I have read and agree to the Summyz Individual Contributor License Agreement 1.0. I am contributing as an individual and have the right to license my Contribution.";
export const AUTHORSHIP_TEXT =
  "I confirm that every commit in this pull request is authored only by me, is linked to my GitHub account, and contains no `Co-authored-by` trailer.";

const SIGNATURE_FIELDS = new Set([
  "agreement",
  "claVersion",
  "legalName",
  "githubLogin",
  "acceptedAt",
  "acceptanceText",
]);

const LEGAL_NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'’-]{1,119}$/u;
const GITHUB_LOGIN_PATTERN = /^(?!-)[A-Za-z0-9-]{1,39}(?<!-)$/;

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkedStatementPattern(statement) {
  return new RegExp(`^\\s*-\\s*\\[[xX]\\]\\s*${escapeRegularExpression(statement)}\\s*$`, "m");
}

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

export function validateLegalName(value) {
  const legalName = value.trim();
  if (!LEGAL_NAME_PATTERN.test(legalName)) {
    throw new Error("Legal name must contain 2-120 valid name characters.");
  }
  return legalName;
}

export function validateGitHubLogin(value) {
  const login = value.trim();
  if (!GITHUB_LOGIN_PATTERN.test(login)) {
    throw new Error("GitHub login is invalid.");
  }
  return login;
}

export function extractLegalName(body) {
  const matches = [...body.matchAll(/^CLA legal name:\s*(.*?)\s*$/gm)];
  if (matches.length !== 1) {
    throw new Error("Provide exactly one `CLA legal name:` field.");
  }
  return validateLegalName(matches[0]?.[1] ?? "");
}

export function validatePullRequestAcceptance({ body, pullRequestLogin, commits }) {
  if (!checkedStatementPattern(ACCEPTANCE_TEXT).test(body)) {
    throw new Error("Accept the exact Individual CLA 1.0 statement in the pull request body.");
  }
  if (!checkedStatementPattern(AUTHORSHIP_TEXT).test(body)) {
    throw new Error("Confirm the exact individual-authorship statement in the pull request body.");
  }

  const legalName = extractLegalName(body);
  if (commits.length === 0) {
    throw new Error("The pull request must contain at least one commit.");
  }

  for (const commitValue of commits) {
    const commit = requireObject(commitValue, "commit");
    const details = requireObject(commit.commit, "commit.commit");
    const message = requireString(details.message, "commit.commit.message");
    if (/^co-authored-by\s*:/imu.test(message)) {
      throw new Error("Co-authored commits are not accepted by the individual CLA workflow.");
    }

    const author = requireObject(commit.author, "commit.author");
    const authorLogin = requireString(author.login, "commit.author.login");
    if (authorLogin.toLowerCase() !== pullRequestLogin.toLowerCase()) {
      throw new Error(
        `Every commit must be linked to @${pullRequestLogin}; found a commit linked to @${authorLogin}.`,
      );
    }
  }

  return legalName;
}

export function validateSignatureRecord(value, expected) {
  const record = requireObject(value, "CLA signature record");
  const unexpectedFields = Object.keys(record).filter((field) => !SIGNATURE_FIELDS.has(field));
  if (unexpectedFields.length > 0) {
    throw new Error(
      `Signature record contains fields that must not be public: ${unexpectedFields.join(", ")}.`,
    );
  }
  const agreement = requireString(record.agreement, "signature agreement");
  const version = requireString(record.claVersion, "signature claVersion");
  const legalName = validateLegalName(requireString(record.legalName, "signature legalName"));
  const githubLogin = validateGitHubLogin(
    requireString(record.githubLogin, "signature githubLogin"),
  );
  const acceptedAt = requireString(record.acceptedAt, "signature acceptedAt");
  const acceptanceText = requireString(record.acceptanceText, "signature acceptanceText");

  if (agreement !== "Summyz Individual Contributor License Agreement") {
    throw new Error("Signature record identifies the wrong agreement.");
  }
  if (version !== CLA_VERSION) {
    throw new Error(`Signature record must use CLA version ${CLA_VERSION}.`);
  }
  if (legalName !== expected.legalName) {
    throw new Error("Signature legal name must match the pull request legal name.");
  }
  if (githubLogin.toLowerCase() !== expected.githubLogin.toLowerCase()) {
    throw new Error("Signature GitHub login must match the pull request author.");
  }
  if (acceptanceText !== ACCEPTANCE_TEXT) {
    throw new Error("Signature record must contain the exact CLA acceptance statement.");
  }
  if (!Number.isFinite(Date.parse(acceptedAt))) {
    throw new Error("Signature acceptedAt must be an ISO 8601 timestamp.");
  }

  return { legalName, githubLogin, acceptedAt };
}

export function signaturePathFor(login) {
  return `.cla/signatures/v1/${validateGitHubLogin(login).toLowerCase()}.json`;
}
