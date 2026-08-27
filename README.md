# WorkHub Goal Room

A clean-room, public competition edition demonstrating one idea:

> WebMCP should make an agent’s next legal action explicit, governed, and visible to the human sharing the page.

## Current scope: Phase 0

This commit proves only that a qualifying WebMCP client can:

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
