type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: {
    type: "object";
    additionalProperties: false;
    properties: Record<string, unknown>;
    required: string[];
  };
  annotations: { readOnlyHint: false };
  execute: (input: { message: string }) => Promise<Record<string, unknown>>;
};

export type ModelContext = {
  registerTool: (
    tool: ToolDefinition,
    options?: { signal: AbortSignal } | AbortSignal,
  ) => unknown;
};

type ModelContextHost = {
  modelContext?: ModelContext;
};

type InstallOptions = {
  documentLike: ModelContextHost;
  navigatorLike: ModelContextHost;
  onPing: (message: string) => void;
};

export type RegistrationResult = {
  status: "registered" | "unsupported";
  dispose: () => void;
};

export function installGoalRoomPing({
  documentLike,
  navigatorLike,
  onPing,
}: InstallOptions): RegistrationResult {
  const modelContext = documentLike.modelContext ?? navigatorLike.modelContext;

  if (typeof modelContext?.registerTool !== "function") {
    return { status: "unsupported", dispose: () => undefined };
  }

  const controller = new AbortController();
  const tool: ToolDefinition = {
    name: "workhub_goal_room_ping",
    title: "Ping WorkHub Goal Room",
    description:
      "Prove that this WorkHub Goal Room is callable through WebMCP and visibly record a short message on the shared page.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: {
          type: "string",
          minLength: 1,
          maxLength: 160,
          description: "A short message to display in the Goal Room.",
        },
      },
      required: ["message"],
    },
    annotations: { readOnlyHint: false },
    async execute({ message }) {
      onPing(message);
      return {
        ok: true,
        room: "WorkHub Goal Room",
        phase: "PHASE_0_WEBMCP_PROOF",
        message,
        visibleStateChanged: true,
      };
    },
  };

  try {
    modelContext.registerTool(tool, { signal: controller.signal });
  } catch {
    modelContext.registerTool(tool, controller.signal);
  }

  return {
    status: "registered",
    dispose: () => controller.abort(),
  };
}
