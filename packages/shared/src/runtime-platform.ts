export function assertSupportedRuntimePlatform(platform: NodeJS.Platform = process.platform): void {
  if (platform !== "win32" && platform !== "linux") {
    throw new Error("Summyz supports only Windows and Linux; this operating system is unsupported");
  }
}

// Entry points import this module before configuration, native dependencies, or resources.
assertSupportedRuntimePlatform();
