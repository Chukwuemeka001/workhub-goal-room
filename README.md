# WorkHub Goal Room

A clean-room, public competition edition demonstrating one idea:

> WebMCP should make an agent’s next legal action explicit, governed, and visible to the human sharing the page.

## Phase 0 result

**PASS — verified August 27, 2026 in Google Chrome Canary 154 with the browser's WebMCP testing and DevTools experiments enabled.**

The page tool was discovered through `document.modelContext.getTools()`, invoked through `document.modelContext.executeTool()`, returned a structured result, and visibly updated the shared page to show “Phase 0 is alive” with invocation count `1`.

This proves WebMCP registration, browser discovery, typed invocation, structured return, and shared-page state change. It does **not** claim autonomous model tool selection or implement the later Goal Room governance phases.

A qualifying client can:

1. discover `workhub_goal_room_ping`;
2. invoke it with a short message;
3. visibly change the same Goal Room page;
4. receive a structured confirmation.

It does **not** yet implement Plan authority, admitted work, candidate custody, independent verification, owner acceptance, production authentication, or real external effects.

## Local development

```bash
npm install
npm test
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Phase 0 judge prompt

> Open this page, inspect its available WebMCP tools, and call the WorkHub Goal Room ping tool with the message “Phase 0 is alive”. Then report whether the page visibly changed.

## Public/private boundary

This repository is standalone and synthetic. It does not import or depend on private Atlas/WorkHub repositories, client data, provider credentials, or live production effects.

## License

Apache License 2.0.
