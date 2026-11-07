# Repository Agent Instructions

## Branch and Worktree Isolation

- Read `DEVELOPMENT_WORKFLOW.md` before starting implementation. Inspect `pwd`, `git status --short --branch`, and `git worktree list` before editing.
- `main` is the shared integration baseline. Perform feature work in a dedicated branch and worktree created from current `main`; keep CPU and core-loop work in separate directories.
- Use the worktree assigned to the task. Never switch branches in another chat's worktree, edit another lane's files through its checkout, or merge another lane just to publish a feature.
- Preserve uncommitted work. If a requested baseline update encounters a dirty worktree, identify its owner and carry or checkpoint those edits only with authorization. Do not stash, reset, clean, or discard them automatically.
- Treat `src/game/engine.ts`, shared types, `src/App.tsx`, and `GAMEPLAY_STATE.md` as shared integration points. Separate worktrees isolate files, but changes to the same code may still require merge conflict resolution.
- Integrate finished feature commits into `main`, then merge updated `main` into other active feature branches. Keep unfinished checkpoint commits on their feature branch.
- Deploy the requested integrated state from `main` by default. Deploying an isolated feature branch requires an explicit request identifying that scope. Existing `cpu-publish` and `cpu-play-plan` branches are historical; do not use them as the baseline for new work.

## Current Gameplay Source of Truth

Before planning or changing gameplay, combat, balance, doctrine, aircraft roles, intelligence, routing, phase flow, or battlefield presentation, read [`GAMEPLAY_STATE.md`](./GAMEPLAY_STATE.md) in full.

`GAMEPLAY_STATE.md` is the running log and source of truth for the current state of game mechanics and design. Keep it synchronized with the implementation:

- Update the relevant sections in the same change whenever mechanics or gameplay presentation change materially.
- Append a dated entry to its **Running Change Log** for every material gameplay or design change.
- Describe only behavior that is actually implemented. Put incomplete or scaffolded systems in the inactive/incomplete section.
- If the document disagrees with the code, verify the behavior in code, correct the document, and call out the discrepancy in the handoff.
- Do not rely on the README alone for current mechanics; it contains historical and aspirational design material.

## Browser Testing Permission

Never perform browser-control testing, including automated browser interaction, screenshots, visual QA, or browser-based UI checks, without obtaining the user's explicit permission first. Do not treat a general request to test or verify changes as permission to use browser control; ask specifically before starting it.

## Agent Workflow

- Use the multi-agent workflow automatically only when the issue explicitly has **High complexity** or **Large (L) T-shirt size**. Either classification is sufficient; use the issue's stated classification or the user's explicit classification, not an inferred rating.
- For all other work, including issues without a classification, use a single agent unless the user explicitly requests subagents. Perceived difficulty, nontrivial architecture, or substantive changes alone do not authorize delegation. An explicit request for one delegated task authorizes that scope, not the entire workflow.
- Luna (`gpt-6-luna`, high reasoning) remains the project default. Below the threshold, the active primary agent performs planning, implementation, and verification itself, even if its selected model is Astra.
- When the threshold is met, use Astra (`gpt-6-astra`, high reasoning) for planning, Luna for implementation, and Sol for independent review. The planner provides concise architecture, ownership boundaries, and acceptance checks; it never edits code. If the primary agent is already Astra, it plans and delegates implementation to Luna without spawning a duplicate planner.
- Delegate implementation only for independent, bounded tasks with disjoint file ownership. Run no more than three child agents at once; children do not delegate further. Give each child a brief task summary and only the context it needs instead of copying full history.
- Within the authorized multi-agent workflow, ask Sol (`gpt-6-sol`, high reasoning) for an independent review after the diff is stable. The reviewer gathers evidence for bugs and missing tests and does not edit files. Do not spawn a reviewer below the threshold unless the user explicitly requests subagents for review.
- Make one focused revision pass from review findings. If uncertainty remains, return it to the planner; do not silently upgrade to a more costly model.
- If the agent interface does not expose these named roles, select the documented model and reasoning effort explicitly in fresh-context agents and include the relevant role instructions. Do not claim that automatic role routing is enforced.
- Carry the gameplay source-of-truth and browser-testing permission rules above into delegated tasks whenever they apply.

## OpenAI Sites Deployment

For requests to deploy this project to its existing ChatGPT managed Site, invoke `npm run deploy:openai` and follow [the local deployment workflow](./skills/deploy-openai-site/SKILL.md). The command handles build, source sync, and archive packaging; use the native Sites connector for credential issuance and production publication. Never put credentials in source, shell arguments, environment files, or logs.
