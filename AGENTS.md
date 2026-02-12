# AGENTS.md

This file provides guidance to code when working with code in this repository.

## ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in .agents/PLANS.md) from design to implementation. If you write an ExecPlan, save the file into the `docs/exec-plans` directory.

Rules for naming ExecPlan files: `YYYYMMDD-<order>-short-description.md`. The order is represented by two digits indicating which plan it is for that day, such as `01`, `02`.

Do not modify existing ExecPlans. Instead, create a new ExecPlan if you need to make changes.

## You Need To

- Plan Mode: You need to first understand the source code and identify which Skills you need to utilize.
- Code Mode: You should actively call various Skills to accomplish the task.

## Additional AGENTS.md Files

if there is AGENTS.md/CLAUDE.md in subdirectories, please also follow the guidelines described in those files.

## Skills (Auto-loaded)

All AI development skills are available in `.agents/skills/` directory:

| Category    | Skills                                     |
| ----------- | ------------------------------------------ |
| Frontend    | `react`, `typescript`                      |
| State       | `zustand`                                  |
| Backend     | `drizzle`                                  |
| Performance | `vercel-react-best-practices`              |
| Overview    | `project-overview`                         |
