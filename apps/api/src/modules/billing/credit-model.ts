export const CREDIT_UNITS_PER_CREDIT = 100;
export const BASE_CREDIT_UNITS_PER_CUSTOMER_REPLY = 50;
export const BASE_CREDIT_UNITS_DEFAULT = 100;
export const INCLUDED_PROMPT_TOKENS_PER_ACTION = 1000;
export const INCLUDED_COMPLETION_TOKENS_PER_ACTION = 500;

const PROMPT_TOKENS_PER_CREDIT = 1000;
const COMPLETION_TOKENS_PER_CREDIT = 500;

function normalizedActionCount(actions: number) {
  return Math.max(0, Math.floor(actions));
}

export function baseCreditsForActions(actions: number): number {
  const actionCount = normalizedActionCount(actions);
  if (actionCount === 0) return 0;
  return (actionCount * BASE_CREDIT_UNITS_PER_CUSTOMER_REPLY) / CREDIT_UNITS_PER_CREDIT;
}

export function baseCreditsForNextAction(priorActions: number): number {
  const prior = normalizedActionCount(priorActions);
  return baseCreditUnitsForNextAction(prior) / CREDIT_UNITS_PER_CREDIT;
}

export function baseCreditUnitsForNextAction(priorActions: number): number {
  const prior = normalizedActionCount(priorActions);
  return BASE_CREDIT_UNITS_PER_CUSTOMER_REPLY;
}

export function computeUsageOverageCredits(
  promptTokens: number,
  completionTokens: number,
  actions = 1,
): number {
  return computeUsageOverageUnits(promptTokens, completionTokens, actions) / CREDIT_UNITS_PER_CREDIT;
}

export function computeUsageOverageUnits(
  promptTokens: number,
  completionTokens: number,
  actions = 1,
): number {
  const prompt = Math.max(0, Math.floor(promptTokens));
  const completion = Math.max(0, Math.floor(completionTokens));
  const actionCount = normalizedActionCount(actions);

  if (actionCount === 0) {
    return 0;
  }

  const includedPrompt = actionCount * INCLUDED_PROMPT_TOKENS_PER_ACTION;
  const includedCompletion = actionCount * INCLUDED_COMPLETION_TOKENS_PER_ACTION;

  const promptOverage = Math.max(0, prompt - includedPrompt);
  const completionOverage = Math.max(0, completion - includedCompletion);

  const promptOverageCredits = Math.ceil(promptOverage / PROMPT_TOKENS_PER_CREDIT);
  const completionOverageCredits = Math.ceil(completionOverage / COMPLETION_TOKENS_PER_CREDIT);

  return (promptOverageCredits + completionOverageCredits) * CREDIT_UNITS_PER_CREDIT;
}

export function computeUsageDebitUnits(
  promptTokens: number,
  completionTokens: number,
  actions = 1,
  baseUnitsPerAction = BASE_CREDIT_UNITS_DEFAULT,
): number {
  const actionCount = normalizedActionCount(actions);
  if (actionCount === 0) return 0;

  const baseUnits = actionCount * Math.max(0, Math.floor(baseUnitsPerAction));
  const overageUnits = computeUsageOverageUnits(promptTokens, completionTokens, actionCount);
  return baseUnits + overageUnits;
}

export function computeUsageCredits(
  promptTokens: number,
  completionTokens: number,
  actions = 1,
): number {
  return computeUsageDebitUnits(promptTokens, completionTokens, actions, BASE_CREDIT_UNITS_DEFAULT)
    / CREDIT_UNITS_PER_CREDIT;
}