# The supervisor-and-kittens model

How the CyberDash supervisor works with kittens: who decides, who builds, which model does which job, and the
brief every kitten gets.

## Who does what

- **The supervisor reasons, plans, reviews, and never hands judgement to a cheap model.** It reads the issue, decides
  the approach, writes the brief, reviews the diff against the issue and the checks, and decides whether to merge.
- **Kittens edit and measure.** A kitten is given a brief and builds to it: it makes the change, runs the checks the
  brief names, and reports back facts (what changed, what passed, what it saw) — not judgement calls the brief didn't
  ask for.
- **On a model-behaviour problem** (the model did something wrong, a prompt needs fixing, an eval regressed), the
  supervisor reads the failing samples' own reasoning itself — targeted, just the decision steps, not whole logs —
  works out what the model concluded and why, and designs the change to what it's shown. A kitten then makes that
  change and runs the measurement. Never defer the high-level reasoning ("why did it do this, what should change")
  to a kitten; that's the supervisor's job every time.

## Models and usage

- **The Claude plan has two limits: a 5-hour session and a week.** Watch both: at the start of a working session,
  before starting a batch of kittens, while kittens run, and before resuming a long kitten. The host reports usage
  on every message and when it crosses each 10% threshold — rely on that; don't write a meter-watching script of
  your own.
- **Opus is only for the main conversation** — planning with the owner, reasoning, reviewing. Never start an Opus
  kitten, and always set a kitten's model explicitly: an unset model inherits the supervisor's, which may be Opus.
- **Haiku** for mechanical jobs (cleanups, lookups, notes from a tight brief). **Sonnet** for building, reviews and
  anything that needs judgement.
- **Sonnet and Haiku cost nothing extra while the plan has room; OpenRouter models (e.g. GLM) always cost money,
  even if little.** So with plenty of session and week left, prefer Sonnet and Haiku.
- **At about 70% of either the session or the week** (or if extra-usage billing would start), move kitten work to
  cheap OpenRouter models (GLM) and keep Opus for planning and review. Bring GLM in for narrow jobs as the limits
  get closer, well before they run out, so the week is never exhausted. Go back to Sonnet/Haiku once the limit
  resets. The aim is steady progress inside the plan's limits, without extra-usage billing.
- **GLM is effective and very cheap for narrowly focused, tightly briefed jobs**; judgement-heavy work goes to
  Sonnet unless the week is short.
- **Lessons from GLM kittens:** they tend to skip checks beyond the ones named, leave work uncommitted, and miss
  distant tests a change breaks. So name every check explicitly in the brief, require a clean `git status` before
  the kitten reports done, and have the supervisor re-run the key checks before merging. Faster OpenRouter models
  that were tried (e.g. DeepSeek) gave the same quality at about twice the cost and bent stop rules to keep going;
  if you use one, say "do not work around the stop rule" outright in the brief.
- **Token frugality comes first.** A kitten once spent 1.5 hours and touched 30 files on a promised one-line fix,
  because the brief asked for more than the promise. Keep briefs to the goal, not finished code (handing over
  finished code wastes the supervisor's own tokens writing it) — with a file budget and a stop rule on every brief.
- **Start a fresh kitten per PR** rather than resuming one ever-growing kitten: resuming a long-running kitten
  re-reads its whole context, which costs more than starting clean.
- **There is no test suite.** "Run the touched tests" becomes "typecheck, lint, and look at the game." Push and
  let CI run typecheck, lint and build, then fix what it reports.

CyberDash has no separate model IDs to alias: the built-in Agent tool takes `model: "sonnet"` or `model: "haiku"`
(never unset, never `"opus"`) for same-source kittens. For GLM or another OpenRouter model, call
`mcp__glade-agents__list_models` then `mcp__glade-agents__dispatch`.

## Every brief has a budget and a stop rule

- **The brief matches what was promised to the owner.** If the supervisor called something a one-line fix, the
  brief names the file and line and the test it breaks — nothing more. Cleanups, dead-code removal and doc sweeps
  the brief didn't ask for are separate follow-ups to raise, not fold in.
- **State the file budget:** the files (or how many) the kitten may touch.
- **State the stop rule:** "If this needs more files than the budget, or you'd remove code the brief doesn't name,
  stop and report a short plan before editing. Don't work around this rule by doing it anyway."
- **Plan first for anything beyond a small edit.** The kitten returns a short plan (files, approach, size) before
  it builds. Plan without a worktree; once the plan is approved, start (or resume) the kitten into a worktree for
  the actual build.

## Isolation

- **A building kitten on the tooling track always gets `isolation: "worktree"`** (the Agent tool's `isolation`
  parameter, or `mcp__glade-agents__dispatch`'s). It works on its own git worktree and branch; the main checkout
  stays on `main`, clean, at all times.
- A kitten that only plans (no edits yet) doesn't need a worktree; give it one when it moves to building.
- **Game dev kittens are the exception:** they edit in the main checkout, no worktree, one at a time, so the
  change hot-reloads in the dev server Jared and the supervisor are both watching.

## Checks in proportion

- Locally: `npx tsc --noEmit`, `npx biome check src/` (`npm run lint:fix` to auto-fix), and `npm run build`.
- There's no test suite, so "run the touched tests" becomes "typecheck, lint, and look at the game": `npm run dev`
  (port 3000) to watch it live, or the supervisor's headless `npm run look` (see `.claude/skills/look/SKILL.md`).
  Headless FPS numbers are meaningless — it's software GL — so don't read anything into them.
- CI (`.github/workflows/ci.yml`) runs typecheck, lint and build on every PR and push to `main`; that's the full
  check battery here, so there's nothing further to leave to CI.

## Watch running kittens

- Check each running kitten once, about 30 minutes in: its diff so far, whether it has opened a PR, whether it has
  drifted from the brief. Stop it if it has.
- **When the owner pauses work, stop every running kitten at once.** Their worktrees keep the work, so nothing is
  lost; resume or restart them once work resumes.

## Kittens never contact the owner

- A kitten has no owner-facing tools: no asking the owner a question, no changing the task's title, objective or
  status, no filing artifacts directly to the owner. Those are the supervisor's alone.
- A question or an update for the owner goes in the kitten's report back to the supervisor; the supervisor relays
  it or decides, never the kitten.

A kitten may still see the task-level Glade tools (`ask`, `set_title`, `set_objective`, `set_status`,
`create_todo`, `update_todo`, `add_artifact`) in its tool list; it must not call them. Every brief says so.

## Kittens stay inside their worktree and /tmp

- A kitten reads and writes only inside its own worktree, `/tmp`, and any path its brief explicitly names.
- No wandering the home folder or other projects' folders looking for context; if it needs something from outside,
  it asks the supervisor (in its report, or by stopping and reporting if the brief allows that).

## Things a kitten never does

- No `git stash`: the stash stack is shared by every worktree and session on the machine, so one kitten can pop
  another's work. Set work aside with a temporary WIP commit instead.
- No force push.
- Never changes any login/auth state for GitHub or any other service the project uses.
- Never skips a hook or bypasses a check to get a commit through.

## Reporting test and eval results

- **Always report counts as passing counts:** "13/15 passed" means 13 of 15 did the right thing. Never report a
  failure count as k/N, and never switch direction between lines in the same report.
- Describe a failure in words ("2 samples didn't call the tool before changing the record"), not as a fraction.
- Every kitten brief that asks for results says to report this way, and the supervisor translates a kitten's report
  into this form before relaying it if the kitten got it backwards.

## Brief template

Dispatch with the Agent tool (`model: "sonnet"` or `model: "haiku"`), or `mcp__glade-agents__dispatch` for GLM.
Reuse this shape for a kitten brief:

```
[todo N] <one-line description of the job>

Goal: <what the change should accomplish, in the owner's terms>

Context: <what's already known — the issue, what's been ruled out, relevant file paths/lines>

Budget: touch at most <N files / these named files>.

Stop rule: if this needs more than the budget, or you'd remove code this brief doesn't name,
stop and report a short plan before editing. Don't work around this rule.

Checks: run npx tsc --noEmit, npx biome check src/, and npm run build. There's no test suite, so
look at the game instead (npm run dev, or npm run look for a headless view).

Report: <PR URL or diff summary>, which checks passed (as a passing count, e.g. "4/4 passed"),
any decision you made that the brief left open, and anything you'd flag for the owner (routed
through me, not to the owner directly).
```
