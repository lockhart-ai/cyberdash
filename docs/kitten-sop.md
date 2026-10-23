# Kitten SOP: issue to merged PR

The standard procedure from issue to merged PR for CyberDash's **tooling/process track** (CI, harness, scripts,
docs, dependencies). The **game dev track** (gameplay, rendering, assets, levels) skips all of this — no issue, no
branch, no PR, just a commit straight to `main`; see `CLAUDE.md`'s "How we work" for that track.

## Issues

- **Title:** `Area: what is wrong or wanted`, in sentence case, no full stop. The area is the part of the product a
  user would name.
- **Body**, in this order, leaving out a section with nothing in it:
  1. What was seen or asked, quoting the owner's own words where there are any.
  2. `## Decided`: who decided what, and when. A call made without the owner says so.
  3. `## Behaviour`: what the product does once this is done.
  4. `## Acceptance criteria`: statements that are true when it's done — not a list of work.
- **Labels:** exactly one of `bug`, `feature`, `infra`, `documentation`; add `meta` to an umbrella issue whose body
  lists child issues as a task list.
- **One issue, one piece of behaviour.** Something found along the way gets its own issue, filed at once — not a
  paragraph buried in a PR.

Tracker is GitHub issues on `lockhart-ai/cyberdash`; always pass `--repo lockhart-ai/cyberdash` to `gh`.

## Branches

- `<issue>-<short-slug>`: the issue number, then two to four lowercase words joined by hyphens.
- A second PR for the same issue takes a different slug.
- Whoever edits files works in their own git worktree; the main checkout stays on `main`, clean.

## Commits

- `<issue>: Imperative summary`, sentence case, no full stop.
- A merge of the default branch into a working branch says what it brings.
- Commits keep a co-authorship trailer naming the agent that made them: `Co-Authored-By: <Model name>
  <noreply@anthropic.com>` (e.g. `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`).

## Pull requests

- **Title:** the same form as the commit, since it becomes the squash commit on the default branch.
- **One issue per PR.** An issue may take several PRs; a PR never covers two issues.
- **Body**, in this shape, leaving out a section that would be empty:

  ```
  One plain sentence saying what this PR does, for someone who knows nothing about it yet.

  Because:
  - why this change is needed

  This commit:
  - what it changes

  Not in this change:
  - what was left for later, if anything

  Calls made without the owner:
  - each decision the issue didn't settle

  Closes #123
  ```

  **That opening sentence matters most:** it's often all that shows in a phone notification or a PR list, so it
  has to sum up the whole PR for someone who hasn't read the issue. Never open with context the reader is assumed
  to have ("Fixes the race from before", "Follow-up to #12"). Use `Refs #123` instead of `Closes` when the issue
  stays open for a later PR.
- **No generated-by footer in the PR body**; a commit's own co-authorship trailer is enough attribution.
- **One kind label per PR** mirroring the issue it closes: `bug`, `feature`, `infra` or `documentation`.
- **The author doesn't approve or merge their own PR.** Kittens author; the supervisor reviews and merges — Jared
  lets the supervisor merge without him.

PR and issue calls use the owner's own `gh` login; no separate bot identity.

## The supervisor's review

Before approving:

- Read the diff against the issue's acceptance criteria.
- Confirm the checks are green: typecheck, lint, build, CI (`.github/workflows/ci.yml`).
- Confirm the change stayed inside the brief's scope — no unrequested cleanup, no files outside the budget.
- Send it back to the kitten with specific fixes if anything is missing; don't merge a PR that fails a check.

No screenshots or recordings are needed — Jared and the supervisor look at the running game together, not at the
PR. Only once all of the above holds: approve, then merge through `gh pr merge`.

"Fail loudly; no silent fallbacks" (`CLAUDE.md`'s Conventions) holds for tooling code too.
