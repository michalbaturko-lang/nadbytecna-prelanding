// Imported mail is not automatically within the approved external-AI scope.
// Explicit thread revocation wins even when the deployment permits all Inbox.
export function mailAiScopeAllows(thread, env = process.env) {
  return Boolean(thread && thread.ai_scope_blocked !== true &&
    (thread.ai_scope_approved === true || env.AI_EMAIL_SCOPE === "all"));
}
export function mailAiAllowUnmarked(env = process.env) {
  return env.AI_EMAIL_SCOPE === "all";
}
