type ViewElement = {
  textContent: string | null;
  dataset: Record<string, string | undefined>;
};

type Phase0Elements = {
  support: ViewElement;
  message: ViewElement;
  count: ViewElement;
};

type RegistrationStatus = "registered" | "unsupported";

export function createPhase0View({
  support,
  message,
  count,
}: Phase0Elements) {
  let invocationCount = 0;

  return {
    showRegistration(status: RegistrationStatus) {
      support.dataset.status = status;
      support.textContent =
        status === "registered"
          ? "WebMCP tool registered"
          : "WebMCP unavailable in this browser. Use a qualifying ChatGPT or Chrome client";
    },
    recordPing(nextMessage: string) {
      invocationCount += 1;
      message.textContent = nextMessage;
      message.dataset.state = "changed";
      count.textContent = String(invocationCount);
    },
  };
}
