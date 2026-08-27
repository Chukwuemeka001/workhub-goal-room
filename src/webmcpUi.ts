type WebMcpInvocationRecord = {
  toolName: string;
  result: Record<string, unknown>;
};

export function formatWebMcpInvocation({
  toolName,
  result,
}: WebMcpInvocationRecord): string {
  const outcome = result.accepted === true ? "accepted" : "refused";
  const reason =
    typeof result.reasonCode === "string" ? ` · ${result.reasonCode}` : "";
  const stateVersion = Number.isSafeInteger(result.currentStateVersion)
    ? result.currentStateVersion
    : "?";
  return `WebMCP ${outcome} ${toolName}${reason} · S${stateVersion}`;
}
