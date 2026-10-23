import { describe, expect, it } from "vitest";

import {
  InstallationLoginThrottle,
  InstallationLoginThrottleError,
} from "../src/auth/installation-login-throttle.js";

describe("InstallationLoginThrottle", () => {
  it("applies a progressive delay after repeated failures", () => {
    let now = 1_000;
    const throttle = new InstallationLoginThrottle({ now: () => now });

    throttle.recordFailure("127.0.0.1");
    throttle.recordFailure("127.0.0.1");
    expect(() => throttle.check("127.0.0.1")).not.toThrow();

    throttle.recordFailure("127.0.0.1");
    expect(() => throttle.check("127.0.0.1")).toThrow(InstallationLoginThrottleError);
    now += 1_000;
    expect(() => throttle.check("127.0.0.1")).not.toThrow();

    throttle.recordFailure("127.0.0.1");
    expect(() => throttle.check("127.0.0.1")).toThrowError(
      expect.objectContaining({ retryAfterSeconds: 2 }),
    );
  });

  it("clears the failure history after a successful login", () => {
    const throttle = new InstallationLoginThrottle({ now: () => 1_000 });
    throttle.recordFailure("client");
    throttle.recordFailure("client");
    throttle.recordSuccess("client");
    throttle.recordFailure("client");

    expect(() => throttle.check("client")).not.toThrow();
  });

  it("bounds tracked clients to prevent unbounded memory growth", () => {
    const throttle = new InstallationLoginThrottle({ now: () => 1_000 });
    for (let index = 0; index < 10_000; index += 1) {
      throttle.recordFailure(`client-${String(index)}`);
    }
    throttle.recordFailure("overflow-client");
    throttle.recordFailure("client-0");
    throttle.recordFailure("client-0");

    expect(() => throttle.check("client-0")).not.toThrow();
  });
});
