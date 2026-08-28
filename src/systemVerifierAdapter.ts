import type { DispatchResult, GoalRoomState } from "./core/goalRoom";

export type SystemVerificationRoom = {
  getState(): GoalRoomState;
  verifyActiveCandidate(idempotencyKey: string): Promise<DispatchResult>;
};

export type InvocationRecord = {
  toolName: string;
  result: Record<string, unknown>;
};

type SystemVerifierAdapterOptions = {
  room: SystemVerificationRoom;
  onSettled?: () => void;
  onError?: (error: unknown) => void;
};

export function createSystemVerifierAdapter({
  room,
  onSettled = () => undefined,
  onError = () => undefined,
}: SystemVerifierAdapterOptions) {
  const scheduledCandidates = new Set<string>();
  let queue = Promise.resolve();

  return {
    observe(record: InvocationRecord): void {
      if (record.toolName !== "submit_artifact" || record.result.accepted !== true) return;
      const observed = room.getState();
      if (observed.phase !== "CANDIDATE_SUBMITTED" || observed.activeCandidate === null) return;
      const candidate = {
        version: observed.activeCandidate.version,
        sha256: observed.activeCandidate.sha256,
      };
      const key = `system-verify:v${candidate.version}:${candidate.sha256}`;
      if (scheduledCandidates.has(key)) return;
      scheduledCandidates.add(key);

      queue = queue.then(async () => {
        let verificationAttempted = false;
        try {
          const current = room.getState();
          if (
            current.phase !== "CANDIDATE_SUBMITTED" ||
            current.activeCandidate?.version !== candidate.version ||
            current.activeCandidate.sha256 !== candidate.sha256
          ) return;
          verificationAttempted = true;
          await room.verifyActiveCandidate(key);
          try {
            onSettled();
          } catch {
            // Presentation reporting cannot alter or repeat verification.
          }
        } catch (error) {
          if (!verificationAttempted) {
            scheduledCandidates.delete(key);
          } else try {
            const current = room.getState();
            if (
              current.phase === "CANDIDATE_SUBMITTED" &&
              current.activeCandidate?.version === candidate.version &&
              current.activeCandidate.sha256 === candidate.sha256
            ) scheduledCandidates.delete(key);
          } catch {
            // Retain suppression when authoritative settlement cannot be ruled out.
          }
          try {
            onError(error);
          } catch {
            // Error reporting is observational only.
          }
        }
      });
    },
  };
}
