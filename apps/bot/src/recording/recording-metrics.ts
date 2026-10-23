const DISCORD_OPUS_PACKET_DURATION_MS = 20;

export interface PacketLossEstimateInput {
  durationMs: number;
  receivedPackets: number;
  trailingSilenceMs: number;
}

export function estimatePacketLossPercent(input: PacketLossEstimateInput): number {
  const activeDurationMs = Math.max(0, input.durationMs - input.trailingSilenceMs);
  const expectedPackets = Math.floor(activeDurationMs / DISCORD_OPUS_PACKET_DURATION_MS);
  if (expectedPackets === 0) {
    return 0;
  }

  const missingPackets = Math.max(0, expectedPackets - input.receivedPackets);
  return roundToTwoDecimals((missingPackets / expectedPackets) * 100);
}

export function calculateProcessCpuPercent(input: {
  cpuUsage: NodeJS.CpuUsage;
  elapsedMs: number;
}): number {
  if (input.elapsedMs <= 0) {
    return 0;
  }

  const cpuMicroseconds = input.cpuUsage.user + input.cpuUsage.system;
  const elapsedMicroseconds = input.elapsedMs * 1_000;
  return roundToTwoDecimals((cpuMicroseconds / elapsedMicroseconds) * 100);
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
