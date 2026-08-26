export type LocalModelPhase = "transcription" | "refinement" | "summary";

export interface LocalHardwareProfile {
  cpuCores: number;
  gpuMemoryBytes?: number;
  memoryBytes: number;
}

export interface LocalModelCandidate {
  languages: "multilingual" | readonly string[];
  memoryBytes: number;
  minimumCpuCores?: number;
  model: string;
  quality: number;
}

export interface LocalModelSelection {
  hardwareWarning?: true;
  model: string;
  source: "auto" | "explicit";
  status: "selected";
}

interface SelectLocalModelInput {
  candidates?: readonly LocalModelCandidate[];
  hardware: LocalHardwareProfile;
  language: string;
  phase: LocalModelPhase;
  requestedModel: string;
}

const gibibyte = 1_024 ** 3;

const candidatesByPhase: Readonly<Record<LocalModelPhase, readonly LocalModelCandidate[]>> = {
  refinement: [
    multilingualCandidate("qwen3:1.7b", 4, 2, 1),
    multilingualCandidate("qwen3:4b", 7, 4, 2),
    multilingualCandidate("qwen3:8b", 11, 8, 3),
  ],
  summary: [
    multilingualCandidate("qwen3:4b", 7, 4, 2),
    multilingualCandidate("qwen3:8b", 11, 8, 3),
    multilingualCandidate("qwen3:14b", 20, 12, 4),
  ],
  transcription: [
    multilingualCandidate("tiny", 2, 1, 1),
    specializedCandidate("tiny.en", "en", 2, 1, 1),
    multilingualCandidate("base", 3, 2, 2),
    specializedCandidate("base.en", "en", 3, 2, 2),
    multilingualCandidate("small", 5, 4, 3),
    specializedCandidate("small.en", "en", 5, 4, 3),
    multilingualCandidate("medium", 10, 8, 4),
    specializedCandidate("medium.en", "en", 10, 8, 4),
    multilingualCandidate("large-v3", 18, 12, 5),
  ],
};

export function selectLocalModel(input: SelectLocalModelInput): LocalModelSelection {
  if (input.requestedModel !== "auto") {
    return { model: input.requestedModel, source: "explicit", status: "selected" };
  }

  const candidates = input.candidates ?? candidatesByPhase[input.phase];
  const languageCompatibleCandidates = candidates.filter((candidate) =>
    supportsLanguage(candidate, input.language),
  );
  const usableMemoryBytes = Math.max(
    input.hardware.memoryBytes * 0.75,
    (input.hardware.gpuMemoryBytes ?? 0) * 0.9,
  );
  const rankedCandidates = languageCompatibleCandidates
    .filter((candidate) => candidate.memoryBytes <= usableMemoryBytes)
    .filter(
      (candidate) =>
        input.hardware.gpuMemoryBytes !== undefined ||
        input.hardware.cpuCores >= (candidate.minimumCpuCores ?? 1),
    )
    .map((candidate) => ({
      candidate,
      score: candidate.quality + languageSpecializationBonus(candidate, input.language),
    }))
    .sort((left, right) => right.score - left.score);
  const selected = rankedCandidates[0]?.candidate;

  if (selected !== undefined) {
    return { model: selected.model, source: "auto", status: "selected" };
  }

  const fallback = [...languageCompatibleCandidates].sort(
    (left, right) =>
      left.memoryBytes - right.memoryBytes ||
      languageSpecializationBonus(right, input.language) -
        languageSpecializationBonus(left, input.language) ||
      right.quality - left.quality,
  )[0];
  if (fallback === undefined) {
    throw new Error(`No compatible local model is available for ${input.phase}`);
  }
  return {
    hardwareWarning: true,
    model: fallback.model,
    source: "auto",
    status: "selected",
  };
}

function multilingualCandidate(
  model: string,
  memoryGibibytes: number,
  minimumCpuCores: number,
  quality: number,
): LocalModelCandidate {
  return {
    languages: "multilingual",
    memoryBytes: memoryGibibytes * gibibyte,
    minimumCpuCores,
    model,
    quality,
  };
}

function specializedCandidate(
  model: string,
  language: string,
  memoryGibibytes: number,
  minimumCpuCores: number,
  quality: number,
): LocalModelCandidate {
  return {
    languages: [language],
    memoryBytes: memoryGibibytes * gibibyte,
    minimumCpuCores,
    model,
    quality,
  };
}

function supportsLanguage(candidate: LocalModelCandidate, language: string): boolean {
  if (candidate.languages === "multilingual") {
    return true;
  }
  if (language === "auto") {
    return false;
  }

  const normalizedLanguage = language.toLowerCase();
  const baseLanguage = normalizedLanguage.split("-")[0];
  return candidate.languages.some((candidateLanguage) => {
    const normalizedCandidateLanguage = candidateLanguage.toLowerCase();
    return (
      normalizedCandidateLanguage === normalizedLanguage ||
      normalizedCandidateLanguage === baseLanguage
    );
  });
}

function languageSpecializationBonus(candidate: LocalModelCandidate, language: string): number {
  return language !== "auto" && candidate.languages !== "multilingual" ? 0.25 : 0;
}
