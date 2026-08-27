import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import {
  PHASE6_SCENARIOS,
  parsePhase6Decision,
  renderPhase6Prompt,
  runPhase6Conformance,
  scorePhase6Raw,
} from "../src/evaluation/phase6.ts";

const BASE_COMMIT = "83b1e5aca8b640b2d445da95ab21257359c9b50a";
const DEFAULT_PROVIDER = "openai-codex";
const DEFAULT_MODEL = "gpt-5.6-sol";
const EMPTY_TOOLSET = "context_engine";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function option(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function requireOutputPath(): string {
  const value = option("--out");
  if (!value) {
    throw new Error("MISSING_--out");
  }
  return resolve(value);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runConformance(): void {
  const outputPath = requireOutputPath();
  const report = {
    schemaVersion: 1,
    kind: "phase6-provider-free-conformance",
    baseCommit: BASE_COMMIT,
    ...runPhase6Conformance(),
  };
  writeJson(outputPath, report);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.passed) {
    process.exitCode = 1;
  }
}

function sanitizeUsage(usage: Record<string, unknown>): Record<string, unknown> {
  const { session_id: sessionId, ...publicUsage } = usage;
  return {
    ...publicUsage,
    sessionIdentitySha256:
      typeof sessionId === "string" ? sha256(sessionId) : null,
  };
}

function runProvider(): void {
  const outputPath = requireOutputPath();
  const provider = option("--provider", DEFAULT_PROVIDER)!;
  const model = option("--model", DEFAULT_MODEL)!;
  const selectedId = option("--scenario");
  const limitText = option("--limit");
  const limit = limitText ? Number.parseInt(limitText, 10) : undefined;
  let scenarios = selectedId
    ? PHASE6_SCENARIOS.filter((scenario) => scenario.id === selectedId)
    : [...PHASE6_SCENARIOS];
  if (limit !== undefined) {
    scenarios = scenarios.slice(0, limit);
  }
  if (scenarios.length === 0) {
    throw new Error("NO_SCENARIOS_SELECTED");
  }

  const runDirectory = `${outputPath}.artifacts`;
  rmSync(runDirectory, { recursive: true, force: true });
  mkdirSync(runDirectory, { recursive: true });
  const startedAt = new Date().toISOString();
  const cases: Array<Record<string, unknown>> = [];

  for (const scenario of scenarios) {
    const prompt = renderPhase6Prompt(scenario);
    const usagePath = resolve(runDirectory, `${scenario.id}.usage.json`);
    const invocation = spawnSync(
      "hermes",
      [
        "-z",
        prompt,
        "--usage-file",
        usagePath,
        "--provider",
        provider,
        "--model",
        model,
        "--toolsets",
        EMPTY_TOOLSET,
        "--ignore-rules",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 300_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    const rawOutput = invocation.stdout ?? "";
    const stderr = invocation.stderr ?? "";
    let usage: Record<string, unknown> = {};
    try {
      usage = JSON.parse(readFileSync(usagePath, "utf8")) as Record<
        string,
        unknown
      >;
    } catch {
      usage = {};
    }
    const publicUsage = sanitizeUsage(usage);
    writeJson(usagePath, publicUsage);
    writeFileSync(resolve(runDirectory, `${scenario.id}.stdout.txt`), rawOutput);
    if (stderr.length > 0) {
      writeFileSync(resolve(runDirectory, `${scenario.id}.stderr.txt`), stderr);
    }
    const score = scorePhase6Raw(scenario, rawOutput);
    let decision: unknown = null;
    if (score.valid) {
      decision = parsePhase6Decision(rawOutput);
    }
    cases.push({
      scenarioId: scenario.id,
      family: scenario.family,
      promptSha256: sha256(prompt),
      transportExitCode: invocation.status,
      transportSignal: invocation.signal,
      transportError: invocation.error?.message ?? null,
      rawOutput,
      decision,
      score,
      usage: publicUsage,
    });
  }

  const passedCases = cases.filter(
    (item) => (item.score as { passed: boolean }).passed,
  ).length;
  const validOutputs = cases.filter(
    (item) => (item.score as { valid: boolean }).valid,
  ).length;
  const governanceCleanCases = cases.filter(
    (item) =>
      (item.score as { hardVetoes: string[] }).hardVetoes.length === 0,
  ).length;
  const hardVetoCount = cases.reduce(
    (total, item) =>
      total + (item.score as { hardVetoes: string[] }).hardVetoes.length,
    0,
  );
  const sessionHashes = cases
    .map(
      (item) =>
        (item.usage as { sessionIdentitySha256?: unknown })
          .sessionIdentitySha256,
    )
    .filter((value): value is string => typeof value === "string");
  const totals = cases.reduce(
    (summary, item) => {
      const usageRecord = item.usage as Record<string, unknown>;
      for (const key of ["input_tokens", "output_tokens", "total_tokens"] as const) {
        const value = usageRecord[key];
        if (typeof value === "number") {
          summary[key] += value;
        }
      }
      const cost = usageRecord.estimated_cost_usd;
      if (typeof cost === "number") {
        summary.estimated_cost_usd += cost;
      }
      return summary;
    },
    {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
    },
  );
  const transportComplete = cases.every(
    (item) =>
      item.transportExitCode === 0 &&
      item.transportError === null &&
      (item.usage as { completed?: unknown }).completed === true,
  );
  const report = {
    schemaVersion: 1,
    kind: "phase6-fresh-model-calibration",
    claimBoundary:
      "One fresh one-shot model session per distinct scenario; N=1 per scenario; no repeated-case reliability or superiority claim.",
    baseCommit: BASE_COMMIT,
    provider,
    model,
    toolset: EMPTY_TOOLSET,
    startedAt,
    completedAt: new Date().toISOString(),
    scenarioCount: cases.length,
    sessionCount: sessionHashes.length,
    uniqueSessionCount: new Set(sessionHashes).size,
    transportComplete,
    passedCases,
    validOutputs,
    governanceCleanCases,
    hardVetoCount,
    passRate: passedCases / cases.length,
    totals,
    cases,
  };
  writeJson(outputPath, report);
  process.stdout.write(
    `${JSON.stringify({
      outputPath,
      scenarioCount: report.scenarioCount,
      uniqueSessionCount: report.uniqueSessionCount,
      transportComplete,
      passedCases,
      governanceCleanCases,
      hardVetoCount,
    })}\n`,
  );
  if (!transportComplete) {
    process.exitCode = 1;
  }
}

const command = process.argv[2];
if (command === "conformance") {
  runConformance();
} else if (command === "provider") {
  runProvider();
} else {
  throw new Error("USAGE: phase6-evaluate.ts conformance|provider --out PATH");
}
