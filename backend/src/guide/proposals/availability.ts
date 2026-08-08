import type { ProposalAvailability, ProposalType } from './types.ts';

const TYPE_BY_RULE: Partial<Record<string, ProposalType>> = {
  R003: 'multi-page-structure-draft',
  R004: 'multi-page-structure-draft',
  R006: 'duplicate-message-review',
  R007: 'duplicate-postback-review',
  R008: 'https-upgrade-candidate',
  R010: 'postback-display-text',
};

export function proposalAvailabilityForRule(ruleCode: string): ProposalAvailability {
  const type = TYPE_BY_RULE[ruleCode] || null;
  return { available: Boolean(type), type };
}
