# Walk-Forward Optimization — PR cleanup plan

> Scope: `dm/round-35` branch, based on `main` (`4c5409c`)
> Goal: reorganize the existing walk-forward PR into atomic commits, fix the
> concrete issues we already surfaced, and land tests without re-introducing
> the giant single-commit problem. Final landing strategy = squash and merge.

## Current state

Checked before starting:
- `git branch --show-current` → `dm/round-35`
- `git status --short` → staged: `src/app/api/backtest/walk-forward/route.ts`,
  `src/components/panel/walk-forward-modal.tsx`; unstaged: `src/lib/backtest.ts`,
  `src/components/panel/backtest-modal.tsx`, `src/lib/i18n.ts`, `worklog.md`
- `git diff --cached --name-only` → 2 files
- `git diff --name-only` → 4 files
- `git stash list` → one stash (`stash@{0}`) contains all 5 walk-forward files

In other words: the working tree is a mixed bag of staged/unstaged walk-forward
work, not a clean stack of commits yet. We rebuild it from that point.

## PR review summary (what we keep, what we fix now)

The original commit is big, but the feature itself is sound:
- Engine + API + UI + i18n + worklog all present.
- Walk-forward semantics are correct: split history into IS/OOS windows, run
  backtests independently, aggregate OOS performance into robustness metrics.
- UI follows project patterns (Escape closes, dialog role, z-index above parent
  modal).
- `useState` reset on open uses the render-time pattern, which respects the
  repo lint rule about `setState` in effects.

The concrete issues we found and will carry into this cleanup:

1. **Too large / not atomic** — one commit for engine + API + UI + i18n.
   Fix: split into separate commits.

2. **No tests for the new pure logic or the API error path** — AGENTS.md says
   tests are mandatory for pure functions in `src/lib/`, and we should also
   cover the new route’s error paths the same way the existing
   `src/lib/backtest-route.test.ts` covers `/api/backtest`.
   Fix: add `src/lib/backtest-walk-forward.test.ts`.

3. **Table uses `tone="warn"` in the modal** while `RobustnessMetric` only
   declares `positive | negative | neutral | purple`. Renderable, but
   inconsistent.
   Fix: remove `tone="warn"` and use a valid tone for that column.

4. **`backtest.walkForwardResults` added to i18n but not used** in the modal.
   Fix: remove the unused key.

5. **Per-row `efficiency` in the table looks like it duplicates `computeRobustness`,
   but its semantics differ from the aggregated `efficiency` in `robustness`.**
   Fix: add a short UI note explaining why the table computes it per row.

6. **`Total OOS trades` in the summary grid is easy to misread.**
   Fix: add a small label/note saying it is the sum across windows.

7. **Minor i18n parity / polish** — for example the `% In-sample` label and
   duplicated efficiency hint. Not a defect per se, but worth tidying up if we
   touch the modal/i18n anyway.
   Fix: light polish during the UI/i18n commit if it does not balloon scope.

8. **Working-tree hygiene** — the branch currently has the walk-forward change
   spread across staged + unstaged files instead of clean commits.
   Fix: rebuild the commit stack atomically from the current state.

## Out of scope for this PR

- Moving `runBacktest()` / `runMultiSymbolBacktest()` out of `src/lib/backtest.ts`
  to make the walk-forward section easier to extract. That is a later,
  broader refactor.
- Changing the existing backtest route `/api/backtest` contract.
- Rewriting the modal to be “prettier” in some unspecified way. We only fix
  concrete correctness/style issues we can already point to.

## Target commit sequence

### Commit 1 — `src/lib/backtest.ts` (walk-forward engine)

Scope:
- `WalkForwardWindow`
- `WalkForwardRobustness`
- `WalkForwardResult`
- `runBacktestOnKlines()`
- `runWalkForward()`
- `emptyRobustness()`
- `computeRobustness()`

This is the pure-ish core. We keep the same behavior; we are not changing
logic here unless a real bug shows up while writing tests.

Deliverables:
- Keep the walk-forward section in `src/lib/backtest.ts` for now.
- Make the section boundaries cleaner if useful, without turning this into a
  refactor of the whole file.
- Add tests in `src/lib/backtest-walk-forward.test.ts` for:
  - window partitioning logic
  - `computeRobustness()`
  - `emptyRobustness()`
  - key edge cases (empty windows, IS=0 with OOS=0, IS=0 with OOS nonzero,
    robustness-rate inclusion rule, window cap behavior dependent on API/
    engine interaction)

This commit should touch only:
- `src/lib/backtest.ts`
- `src/lib/backtest-walk-forward.test.ts` (new)

### Commit 2 — `src/app/api/backtest/walk-forward/route.ts`

Scope:
- New POST route.
- Same request shape as `/api/backtest` plus `windowSize`, `inSampleRatio`,
  `stepSize`.
- Validation for symbol, interval, strategyId/customStrategy, clamping of the
  new params.
- Inline `error` result on upstream/insufficient-data failures, with status 200.

This commit should touch only:
- `src/app/api/backtest/wwalk-forward/route.ts`

Note: the route already depends on the engine types from commit 1, so commit 1
must land first in the local stack.

### Commit 3 — `src/components/panel/walk-forward-modal.tsx`

Scope:
- New modal component.
- Config: symbol select, window size buttons, in-sample ratio buttons.
- Robustness summary panel.
- Per-window table.
- Escape closes.

In this commit we also apply the UI cleanups:
- Remove `tone="warn"` from the table.
- Clarify the per-row efficiency calculation with a small UI note.
- Clarify that “Total OOS trades” in the summary is the sum across windows.
- Light i18n parity polish only where it is cheap and obviously consistent.

This commit should touch only:
- `src/components/panel/walk-forward-modal.tsx`

### Commit 4 — `src/components/panel/backtest-modal.tsx` + `src/lib/i18n.ts` + `worklog.md`

Scope:
- Integrate the Walk-Forward button into `BacktestModal`.
- Render `<WalkForwardModal>` with current params.
- i18n keys used by the feature.
- Update `worklog.md` if this is the round where the work is being recorded.

In this commit we clean up what is already in the working tree:
- Keep only the keys actually used by the feature.
- Remove unused `backtest.walkForwardResults` if it is not referenced.
- Keep i18n additions in the same commit as the UI that uses them, because
  that is the natural boundary for this feature.

This commit should touch only:
- `src/components/panel/backtest-modal.tsx`
- `src/lib/i18n.ts`
- `worklog.md` (if recording this round)

### Commit 5 — tests for the new code

Scope:
- `src/lib/backtest-walk-forward.test.ts`
- Possibly a lightweight route-level contract test file if we decide the route
  error path deserves its own fixture-level coverage.

What belongs here:
- Deterministic tests of the engine parts from commit 1.
- At least the main error paths of the route from commit 2 (invalid JSON,
  invalid symbol, unknown/custom strategy shape, missing strategy, and the
  200-with-error path for upstream/insufficient data when we can reasonably
  assert it).

What does not belong here:
- Tests that depend on external network availability in a way we cannot
  reasonably make deterministic without the live services.

### Commit 6 — any small follow-up corrections surfaced while implementing

Examples:
- Removing a stray unused key we missed.
- Improving a comment.
- Adjusting a UI note we wrote in commit 3 because it was unclear in context.

We do not pre-create this commit “just in case”; we create it only if there is
something concrete left to fix after the earlier commits.

## Verification strategy

For each commit:
- Stage exactly the files in its scope.
- Run `git status --short`.
- Run `git diff --cached --name-only` and confirm only the intended files are
  staged.
- Before the next commit, confirm the previous commit’s files are already
  committed and not accidentally floating in the next stage.

Before finalizing:
- Review the final `git log --oneline` stack on `dm/round-35`.
- Confirm there is no leftover walk-forward change outside the intended commits.
- Confirm the route and modal files land with the engine types they depend on
  in earlier commits.
- Confirm the tests file exists under `src/lib/` and tests the right units.

## Access notes / limitations in this environment

- The current environment does not have the repo’s dev tooling installed as
  project commands. `git` is available and useful for verification, but
  `bun run test|lint|typecheck` are not usable here as repo scripts.
- Because of that, the strongest automated verification we can do here is
  structural: file presence, staged/unstaged boundaries, and the shape of the
  final commit stack.
- Real test/lint/typecheck passes still need to be confirmed in an environment
  where the repo scripts can run.

## Explicit limitations of this plan

- We are not doing a full refactor of `src/lib/backtest.ts` in this PR.
- We are not inventing new UI beyond the corrections already listed.
- We are not adding tests for things we cannot reasonably cover deterministically
  without the live services.
- If any of the cleaner UI/i18n notes in commits 3 or 4 turn into a bigger
  discussion, we cut them and keep those commits focused on the concrete
  defects only.

## Open questions for the user

- Confirm the commit order: engine → route → modal → modal integration + i18n →
  tests → follow-ups.
- Confirm whether we should include the light UI/i18n polish in commit 3/4 or
  leave it for a later cleanup.
- Confirm whether you want the route error path tested in the same test file as
  the engine, or in its own route-level test file.
