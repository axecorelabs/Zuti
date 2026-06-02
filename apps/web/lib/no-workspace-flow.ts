export type NoWorkspaceFlowChoice = 'JOIN_WORKSPACE' | 'SETUP_WORKSPACE';

const NO_WORKSPACE_FLOW_CHOICE_KEY = 'zuti-no-workspace-flow-choice';

export function getNoWorkspaceFlowChoice(): NoWorkspaceFlowChoice | null {
  if (typeof window === 'undefined') return null;
  const value = localStorage.getItem(NO_WORKSPACE_FLOW_CHOICE_KEY);
  if (value === 'JOIN_WORKSPACE' || value === 'SETUP_WORKSPACE') {
    return value;
  }
  return null;
}

export function setNoWorkspaceFlowChoice(choice: NoWorkspaceFlowChoice): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(NO_WORKSPACE_FLOW_CHOICE_KEY, choice);
}

export function clearNoWorkspaceFlowChoice(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(NO_WORKSPACE_FLOW_CHOICE_KEY);
}

export function resolveNoWorkspaceRoute(): '/join-workspace' | '/setup-workspace' {
  return getNoWorkspaceFlowChoice() === 'SETUP_WORKSPACE' ? '/setup-workspace' : '/join-workspace';
}
