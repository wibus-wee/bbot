export const AUTO_RESUME_PROMPT =
  "Continue the previous task automatically. Do not ask for confirmation."
export const RECOVERY_PROMPT = AUTO_RESUME_PROMPT

export const buildRestartScriptArgs = (
  restartScript: string,
) => {
  return ["exec", "tsx", restartScript]
}
