interface BotConfigurationMonitorOptions {
  expectedVersion: string;
  onChanged(): Promise<void>;
  onError(error: unknown): void;
  readVersion(): Promise<string>;
}

export class BotConfigurationMonitor {
  readonly #expectedVersion: string;
  readonly #onChanged: () => Promise<void>;
  readonly #onError: (error: unknown) => void;
  readonly #readVersion: () => Promise<string>;
  #checking = false;
  #changed = false;
  #timer: NodeJS.Timeout | undefined;

  public constructor(options: BotConfigurationMonitorOptions) {
    this.#expectedVersion = options.expectedVersion;
    this.#onChanged = options.onChanged;
    this.#onError = options.onError;
    this.#readVersion = options.readVersion;
  }

  public start(): void {
    if (this.#timer !== undefined || this.#changed) return;
    this.#timer = setInterval(() => {
      void this.check();
    }, 5_000);
    this.#timer.unref();
  }

  public stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  public async check(): Promise<void> {
    if (this.#checking || this.#changed) return;
    this.#checking = true;
    try {
      if ((await this.#readVersion()) !== this.#expectedVersion) {
        this.#changed = true;
        this.stop();
        await this.#onChanged();
      }
    } catch (error) {
      this.#onError(error);
    } finally {
      this.#checking = false;
    }
  }
}
