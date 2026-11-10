# Working on moniqr

Read and follow [CLAUDE.md](CLAUDE.md) for repository conventions and agent service rules.

## Delivering changes

- Bailey expects completed changes to be committed, pushed to GitHub and merged into `main` by default. Do not leave finished work only in the local workspace.
- Run the checks appropriate to the change before pushing and merging. Follow any branch protections and required checks; do not bypass them.
- If working on a feature branch, push it and merge it into `main` through the repository's normal workflow. If already working on `main` and direct pushes are allowed, commit and push `main`.
- Verify that the resulting commit is on remote `main`, and report the commit or PR in the final response.
- If delivery is blocked, explain the specific blocker and what remains local. Never claim work is pushed, merged or deployed without verifying it.
- Explicit user instructions to keep work local, prepare a draft or stop before delivery override this default. Preserve unrelated work and do not include it in a task's commit.
