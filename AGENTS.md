# Repository Agent Instructions

## Current Gameplay Source of Truth

Before planning or changing gameplay, combat, balance, doctrine, aircraft roles, intelligence, routing, phase flow, or battlefield presentation, read [`GAMEPLAY_STATE.md`](./GAMEPLAY_STATE.md) in full.

`GAMEPLAY_STATE.md` is the running log and source of truth for the current state of game mechanics and design. Keep it synchronized with the implementation:

- Update the relevant sections in the same change whenever mechanics or gameplay presentation change materially.
- Append a dated entry to its **Running Change Log** for every material gameplay or design change.
- Describe only behavior that is actually implemented. Put incomplete or scaffolded systems in the inactive/incomplete section.
- If the document disagrees with the code, verify the behavior in code, correct the document, and call out the discrepancy in the handoff.
- Do not rely on the README alone for current mechanics; it contains historical and aspirational design material.

