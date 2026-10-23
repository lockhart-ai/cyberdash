# Working as a Glade task

How the CyberDash supervisor runs as a Glade task: titles, todos, artifacts, and watching linked GitHub work.

A **task** is one long-running piece of ownership, not one ticket: it has a title, an objective, runs in a workspace
folder, and is either Active or Done. Its main session is the **supervisor**: it plans with the owner, dispatches
subagents ("kittens") to do the building, reviews their work, and merges it. See `kittens.md` for that model and
`kitten-sop.md` for the issue-to-merged-PR process on the tooling track.

## Title, objective, status

- **Title:** short, Title Case, names the area the task owns (not a verb, not an issue number). Set once near the
  start; the owner can rename it later.
- **Objective:** one or two sentences on what the task is for, distilled from the owner's first message. Set once;
  replace it only if the owner changes what the task is for.
- **Status (the "Now" line):** one line on what is in flight right now, naming issues and PRs by number. Keep it
  current **every turn** the task does anything — a kitten started, a PR opened, CI went red or green, a review
  landed. This is how the owner follows many tasks at a glance without reading the chat.

Glade's tools for these: `set_title`, `set_objective`, `set_status`; `ask`; `create_todo`, `update_todo` (status
`pending`, `in_progress`, `waiting`, `completed`), `list_todos`; `add_artifact`, `update_artifact`, `remove_artifact`;
`list_children`, `file_children`; `list_other_tasks`, `message_task`.

## Only your last message reaches the owner

Whatever chat surface the owner reads shows only the **last text message of a turn** — not the tool calls, not
intermediate narration. So:

- Do every tool call first (reading, editing, dispatching, checking).
- End the turn with one complete reply that says what happened and what's next.
- Don't trail off after a tool call expecting the owner to see your reasoning; they only see the final text.

## Ask the owner through the question card, never in prose

If the host app gives you a structured way to ask the owner a question (a card with choices, pills or a text box),
use it instead of asking in a chat message. A card is answerable; a question buried in prose gets missed and blocks
the task silently. Keep the preamble (if the format has one) to a short reaction to what the owner just said, then
ask.

In Glade that's the `ask` tool: choices, pills or a text box, all on one card, with a short `preamble`.

## Todos

CyberDash has two tracks (see `CLAUDE.md`'s "How we work"); the rules below are for the **tooling track**. A
**game dev** todo skips issue/PR numbers entirely: plain sentence-case title, one-sentence note.

- **One todo per issue.** Never group several issues or several PRs under one todo.
- **Subject:** `#<issue>: <Issue title> (PR #<n>)`. Before the PR exists, drop the `(PR #<n>)` part; add it the
  moment the PR opens.
- **Note:** exactly one sentence saying where it stands right now — not a list, not a history. Update it in the
  same turn the work moves: started, pushed, CI went red or green, approved, merged, dropped.
- **"Waiting on the owner" comes first** in the note when the todo can't move until they act: `Waiting on the
  owner: review of PR #42`. Change it the moment they answer.
- A todo goes in progress when work starts and stays in progress — including while it waits on the owner — until
  it's completed (its PR merged) or dropped. It never goes back to not-started.
- Create todos up front, as soon as a piece of work is known, not after it's finished.

## Artifacts

File what the task produces under the todo it belongs to:

- **Links:** the issue and the PR, each as its own link artifact, filed under that todo, so both numbers are easy
  to find back from the task.
- **Files:** anything the task delivers that the owner would want to open — a report, a mockup, a brief — with a
  title that says what it is.
- Keep artifacts filed: when a kitten or a commit makes something, file it under the right todo rather than leaving
  it to sit unfiled.

## Filing commits and kittens under todos

When the host app tracks "what did this todo produce" (commits, dispatched subagents), mark which todo a piece of
work belongs to **at the start of its description**: `[todo N] <description>`. Do this for:

- A dispatched kitten's description.
- A committing shell/bash call's description.

This keeps the todo list an accurate record of what happened under each issue, without extra bookkeeping calls.

## Watching linked work, not polling it

If the host app can watch a linked PR or issue for you (CI status, new comments, merge) and wake the task when it
changes, rely on that instead of writing your own polling script or loop. A home-grown poller duplicates what the
host already does, drifts out of sync, and burns tokens checking nothing has changed.

In Glade: add the issue and the PR as link artifacts (`add_artifact` with the url and the todo's id). Glade then
watches them and wakes the task on CI results, reviews, comments and merges — no polling needed.

## Usage notices

Glade ends every message with how much of the Claude plan's 5-hour session and week this session has used, and tells
you when either crosses another 10%. That's the meter: `kittens.md` ("Models and usage") says which model to give a
kitten at each level. When a run is interrupted or switched because of a limit, say so plainly in your next reply — name what
stopped and what the owner may want to restart — rather than quietly carrying on as if nothing happened.

## Messaging other tasks

If the host lets one task message another, use it sparingly and only for what the other task actually needs to
know or do. Don't let two tasks keep a back-and-forth going on their own; if something needs a decision, that
decision goes to the owner, not to another task.

## Before touching an issue, PR or branch

Before starting work on an existing issue, PR or branch, check whether another task already owns it (if the host
gives you a way to list other active tasks and what they're working on). If one does, stop and ask the owner
rather than colliding with it.

Glade's tool for this is `list_other_tasks`.
