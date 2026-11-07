# CPU and core-game development

## Shared baseline

`main` contains the combined published game: the basic CPU, difficulty menu,
randomized campaign layouts, and committed placement improvements. New work
starts from `main` rather than the historical `cpu-publish` branch.

The setup on this machine uses these persistent directories:

| Lane | Branch | Directory |
| --- | --- | --- |
| Integration | `main` | `/Users/ryanclendening/Development/air_power_game-worktrees/main` |
| CPU improvements | `work/cpu` | `/Users/ryanclendening/Development/air_power_game-worktrees/cpu` |
| Core game loop | `work/core-loop` | `/Users/ryanclendening/Development/air_power_game-worktrees/core-loop` |

Open the matching directory when starting a new chat. Tell the chat which lane
it owns. Each worktree has independent source files, build output, dependencies,
and a checked-out branch; Git history and branches are shared.

The original `/Users/ryanclendening/Development/air_power_game` checkout remains
on `cpu-strategy` with older uncommitted prototype work. It is preserved as an
archive of that work. Do not use it for new implementation or discard its edits.
Earlier temporary worktrees are also retained so existing references remain
recoverable.

## Starting work

1. Inspect `git status --short --branch` and `git worktree list` in the assigned
   directory. Confirm that the branch and directory match the task.
2. Read `AGENTS.md` and `GAMEPLAY_STATE.md` before changing game behavior.
3. Merge current `main` into the feature branch when its worktree is clean.
   Checkpoint or finish existing edits before merging. Do not reset a working
   branch to update it.
4. Install dependencies inside that worktree when needed (`npm ci`). Use
   distinct dev-server ports for simultaneous sessions, for example CPU 5181
   and core loop 5182. Browser storage is separate between these local origins;
   campaign saves will not automatically transfer between them.

For another independent task, create another branch and directory from `main`:

```sh
git -C /Users/ryanclendening/Development/air_power_game-worktrees/main worktree add -b work/TOPIC /Users/ryanclendening/Development/air_power_game-worktrees/TOPIC main
```

Replace `TOPIC` with a short task name. Do not check the same branch out in
multiple worktrees or switch branches in another chat's directory.

## Ownership and integration

- CPU work normally owns `src/game/cpu/` and `CPU_PLAY_PLAN.md`.
- Core-loop work normally owns player-facing phase flow, placement, economy,
  and battlefield interaction.
- The engine, types, App, and gameplay document are shared. Coordinate changes
  to those files and resolve conflicts when integrating; worktrees cannot
  prevent logical conflicts in shared code.
- Commit finished work on its feature branch. Merge that branch into clean
  `main`, perform the checks requested for that change, and push `main`.
- Merge the updated `main` into the other feature branches so they gain the
  integrated changes while retaining their own work.
- Keep unfinished checkpoints on feature branches. The preserved core-loop
  checkpoint from 2026-11-07 is work in progress, not part of the shared baseline.

## Publishing

Publish the intended integrated `main` state with the repository's deployment
skill and `npm run deploy:openai`. Preserve the existing Site and its audience.
Do not merge unfinished work or silently combine active feature branches merely
to deploy one change. Every managed Site publication updates the same live game.

Browser testing still requires explicit user permission. Do not treat a request
to build, integrate, or publish as permission for browser control.
