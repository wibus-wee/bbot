# AGENTS.md

This file provides guidance to code when working with code in this repository.

## ExecPlans

When writing COMPLEX features or significant refactors, use an ExecPlan (as described in .agents/PLANS.md) from design to implementation. If you write an ExecPlan, save the file into the `docs/exec-plans` directory. 

Please do not use ExecPlans for small tasks or bug fixes, as it may introduce unnecessary overhead.

Rules for naming ExecPlan files: `YYYYMMDD-<order>-short-description.md`. The order is represented by two digits indicating which plan it is for that day, such as `01`, `02`.

Do not modify existing ExecPlans. Instead, create a new ExecPlan if you need to make changes. Or, if the change is focusing on fixing the documentation, you can modify the existing ExecPlan directly.

## Development Checks

When modifies this repo, it must run the following as applicable:

- Always run `pnpm run check-types` after code changes.
- If database schema or migrations change, run `pnpm run db:generate`, `pnpm run workflow:dbml`, and `pnpm run db:migrate`.
- If API/protocol/SDK changes, run `pnpm run workflow:sdk`.

### You should

- I only need best practices. Please do not write shit code for me.
- Follow the DRY principle to avoid reinventing the wheel.
- Understand the existing code and identify reusable parts.
- Adhere to the SOLID principles to ensure your design is modular and maintainable.
- Actively call various Skills to accomplish the task.
- Write clean, maintainable code that follows best practices. 
- Focus on the plan you created in the Plan Mode, but be flexible to make adjustments as needed.
- After completing the code, review it to ensure it meets the requirements and adheres to coding standards. Besides, make sure to test the code to verify its functionality and correctness.

## Additional AGENTS.md Files

if there is AGENTS.md/CLAUDE.md in subdirectories, please also follow the guidelines described in those files.

## Skills (Auto-loaded)

All AI development skills are available in `.agents/skills/` directory
