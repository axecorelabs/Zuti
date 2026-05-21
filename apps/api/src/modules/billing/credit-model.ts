export const BASE_CREDITS_PER_ACTION = 1;
export const INCLUDED_PROMPT_TOKENS_PER_ACTION = 1000;
export const INCLUDED_COMPLETION_TOKENS_PER_ACTION = 500;

const PROMPT_TOKENS_PER_CREDIT = 1000;
const COMPLETION_TOKENS_PER_CREDIT = 500;

export function computeUsageCredits(
  promptTokens: number,
  completionTokens: number,
  actions = 1,
): number {
  const prompt = Math.max(0, Math.floor(promptTokens));
  const completion = Math.max(0, Math.floor(completionTokens));
  const actionCount = Math.max(0, Math.floor(actions));

  if (actionCount === 0) {
    return 0;
  }

  const includedPrompt = actionCount * INCLUDED_PROMPT_TOKENS_PER_ACTION;
  const includedCompletion = actionCount * INCLUDED_COMPLETION_TOKENS_PER_ACTION;

  const promptOverage = Math.max(0, prompt - includedPrompt);
  const completionOverage = Math.max(0, completion - includedCompletion);

  const promptOverageCredits = Math.ceil(promptOverage / PROMPT_TOKENS_PER_CREDIT);
  const completionOverageCredits = Math.ceil(completionOverage / COMPLETION_TOKENS_PER_CREDIT);

  return actionCount * BASE_CREDITS_PER_ACTION + promptOverageCredits + completionOverageCredits;
}