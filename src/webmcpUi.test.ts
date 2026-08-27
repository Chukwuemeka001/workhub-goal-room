import { describe, expect, it } from "vitest";
import { formatWebMcpInvocation } from "./webmcpUi";

describe("WebMCP invocation projection", () => {
  it("labels accepted and refused governed invocations truthfully", () => {
    expect(
      formatWebMcpInvocation({
        toolName: "claim_step",
        result: {
          accepted: true,
          currentStateVersion: 3,
          nextLegalAction: "AGENT_SUBMIT_CANDIDATE",
          ownerRequired: false,
        },
      }),
    ).toBe("WebMCP accepted claim_step · S3");

    expect(
      formatWebMcpInvocation({
        toolName: "request_completion",
        result: {
          accepted: false,
          reasonCode: "VERIFICATION_REQUIRED",
          currentStateVersion: 4,
          nextLegalAction: "SYSTEM_VERIFY_CANDIDATE",
          ownerRequired: false,
        },
      }),
    ).toBe("WebMCP refused request_completion · VERIFICATION_REQUIRED · S4");
  });
});
