export async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  operation: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error("A concorrência deve ser um inteiro maior que zero");
  }

  const results = new Array<Output>(inputs.length);
  let nextIndex = 0;
  let failed = false;
  let firstError: unknown;
  const workers = Array.from({ length: Math.min(concurrency, inputs.length) }, async () => {
    while (!failed && nextIndex < inputs.length) {
      const index = nextIndex;
      nextIndex += 1;
      const input = inputs[index];
      if (input === undefined) {
        throw new Error("Índice inválido durante o processamento concorrente");
      }
      try {
        results[index] = await operation(input, index);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstError = error;
        }
      }
    }
  });

  await Promise.all(workers);
  if (failed) {
    throw firstError;
  }
  return results;
}
