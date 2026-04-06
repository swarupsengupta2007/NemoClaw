# PR Comment Template

Use this template when composing the GitHub PR comment. **Keep it short.** The full analysis is shown to the reviewer separately — the PR comment is for the contributor.

---

```markdown
Thanks for this, @{author}! {one sentence on what the PR does}.

**CI:** {all passing / failures noted}

{If blockers exist:}
### Blocking

- **{file}:{line}** — {problem}. {suggested fix}.

{Pick only the top 2-3 non-blocking items worth mentioning:}
### Suggestions

- {concise callout with file ref if needed}
- {concise callout}

{If follow-up issues were filed:}
### Follow-ups filed

- #{issue_number} — {one-line description}
- #{issue_number} — {one-line description}

---

{one-line closing — encouraging, brief}
```

---

## Rules

- **Under 30 lines.** If the PR is clean, the comment can be 5 lines.
- **No empty sections.** If there are no blockers, don't include a Blocking section.
- **No security verdict table** unless there are WARNING/FAIL items the contributor needs to address.
- **No restating the PR description.** The contributor wrote it — they know what it does.
- **No full test coverage analysis.** Mention the 1-2 most important gaps, not all of them.
- **No architecture section** unless there's a genuine concern.
- **Suggestions section:** max 3 bullets. Pick the highest-signal items only.

## Tone Guidelines

- Assume good intent. Be direct but kind.
- Prefer "consider" over "you should."
- Credit good decisions briefly ("nice regression tests").
- For first-time contributors: add a welcome line.
