# Development Guidelines

- Always run `pre-commit` before committing and pushing changes
- To the best of your ability, ensure tests are passing
- Follow assertion style (actual on left, expected on right)
- Always bump the version in `package.json` appropriately when any file under `src/` (except `tests/`), `configs/`, or `package.json`/`package-lock.json` itself, is changed. Bump once per PR: if the version was already bumped by earlier work on the same PR/branch and it hasn't been merged yet, do not bump it again for follow-up commits on that same PR, keep adding entries under the existing top-most `CHANGELOG.md` heading instead
- This project has no formal releases, so there is no `## Upcoming` staging section in `CHANGELOG.md`. Leave a short description of the change or addition directly under the top-most version heading (the same version just bumped in `package.json`; create the heading if it does not yet exist) under the appropriate subsection (`#### 🚀 Enhancement`, `#### 🐛 Bug Fix`, or `#### 🏠 Internal`); create the subsection if it does not yet exist; include the GitHub PR link at the end of each entry in the format `([#N](https://github.com/brain-bbqs/encoding-helper/pull/N))`
- Keep `CHANGELOG.md` entries to a single sentence each, roughly 25 words or fewer: what changed, from the reader's side. Not why, not how, not the reasoning behind it, which belong in the code comments and the PR. Fold related work into one entry rather than giving each part its own
- PR titles should be human-readable and in the past tense; they should NOT use conventional commit style
- Keep PR descriptions as short and concise as possible: the fewest words that describe the change accurately. No walking the diff file by file, no restating what the code already says, no background the reviewer does not need to review it
- Always keep the PR title and description accurate to what the branch currently does. When follow-up commits add, drop or change behaviour, update them in place rather than leaving them describing an earlier state, and correct anything in them that misdescribes the diff
- Limit use of em-dashes in all text
- When a request is genuinely ambiguous, ask in plain text at the end of your reply and stop there. Do not use interactive prompts. Waiting for an answer is fine, there is no time pressure to guess. Bundle related questions into one message rather than asking them one at a time
