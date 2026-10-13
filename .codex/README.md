# Project agent roles

The default agent is Luna (`gpt-6-luna`) with high reasoning. Automatically use the multi-agent workflow only for an issue explicitly classified as **High complexity** or **Large (L) T-shirt size**. Either condition qualifies. All other work, including unclassified issues, stays with one agent unless the user explicitly requests subagents; do not infer a qualifying rating to trigger delegation.

For qualifying issues, use Astra (`gpt-6-astra`, high) as a read-only planner, Luna for bounded implementation, and Sol (`gpt-6-sol`, high) for independent read-only review. If Astra is already the primary agent, it handles planning without an additional planner. Below the threshold, the active primary agent handles the work itself regardless of its model. Explicit requests for subagents apply only to the requested scope. The session allows up to three child agents, with parallel implementation limited to independent tasks with disjoint file ownership.

These role assignments are project guidance; they are not enforced by an automatic scheduler. New sessions load the project configuration. An app-selected model can override the configured default, and restarting the app may be needed if role definitions appear stale.

Configuration was checked against Codex `0.155.0-alpha.9.2` and its model catalog. Strict `doctor config.load` passed and resolved Luna; TOML and model/effort parsing passed. Luna implementation and an independent Sol review both ran successfully; Sol reported no actionable findings. No separate Astra inference probe was needed. The local `codex debug prompt-input` command also completed successfully and included the updated AGENTS.md guidance; this does not verify automatic named-role selection. Doctor network probes failed inside the sandbox, unrelated to the project configuration; this does not mean every doctor check passed.

References: [Multi-agent configuration](https://developers.openai.com/codex/multi-agent) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
