# Goal Room V2 iPhone Contract

## Surface

Primary: **Operate**. Secondary: Inspect.

The iPhone is the owner's control surface, not a compressed engineering dashboard.

## Default information architecture

```text
compact Goal header
→ current chapter and authority
→ one dominant Now card
→ one primary owner action
→ details on demand
→ safe-area action dock
→ Now / Plan / Proof / Activity tabs
```

## Tabs

### Now

- Goal title and compact confirmed/proposed status
- current journey chapter
- actor holding authority
- exact legal next action
- one dominant owner decision or safe waiting state
- concise boundary explanation
- persistent action dock

### Plan

- Goal Contract version and origin
- Done Looks Like
- Constraints and Non-goals
- Plan version and steps
- revision delta rather than forcing full reread

### Proof

- active candidate version and digest
- deterministic checks
- FAIL correction frontier
- PASS boundary
- completion request and owner acceptance binding

### Activity

- concise Origin & Discussion events
- immutable ordered accepted/refused receipts
- source badge: Owner / WebMCP agent / Internal verifier

## Four prototype checkpoints

### 1. Owner intent awaiting Goal proposal

- Goal is not yet admitted
- actor: Agent
- next action: Propose Goal Contract
- owner can edit intent but cannot confirm a nonexistent proposal

### 2. Goal Contract awaiting owner decision

- exact Goal Contract v1 visible
- owner attention dominant
- actions: Request changes / Confirm Goal
- Plan remains legally blocked

### 3. Verification FAIL

- current chapter: Proof
- Candidate v1 and FAIL visible
- exact failed checks visible
- actor: Agent
- next action: Submit corrected evidence
- owner does not receive a misleading approval button

### 4. PASS awaiting owner acceptance

- PASS visible but not celebrated as completion
- exact candidate binding visible
- actor: Owner
- primary action: Accept verified result
- secondary action: Request correction

## Bottom action dock

- fixed above `env(safe-area-inset-bottom)`
- one primary legal action
- optional secondary contextual action
- 48px preferred target height; never below 44px
- no action appears unless legal for the current actor
- state is rerendered from authority after activation

## Responsive targets

- 375×667
- 393×852 primary
- 430×932
- landscape spot check
- keyboard-open revision sheet

## Accessibility and containment

- semantic buttons and tablist
- accessible name includes stage plus status
- `aria-live` only for concise frontier changes
- VoiceOver order: Goal → current chapter → actor/frontier → owner action → details
- no CSS reorder that contradicts DOM reading order
- full visible focus treatment
- reduced-motion support
- all free text uses safe text rendering
- `overflow-wrap:anywhere` for admitted prose and digests
- zero horizontal document overflow

## Design posture

- premium, calm, exact, owner-first
- deep neutral canvas with warm-white text
- restrained amber for owner attention
- cyan/green reserved for agent/system evidence state
- type and spacing create hierarchy before cards
- no desktop hero, six-column lifecycle, equal-weight card grid, glassmorphism, fake metrics, avatars, or neon pipeline art

## Acceptance test

At every checkpoint, the owner must identify within two seconds:

1. the Goal or pending intent;
2. whether it is confirmed;
3. who acts now;
4. the one legal next action;
5. whether the owner must decide.
