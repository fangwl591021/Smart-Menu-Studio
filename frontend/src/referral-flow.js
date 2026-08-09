export const REFERRAL_FLOW_STORAGE_KEY = 'smart_menu_referral_flow';
const store = () => typeof window === 'undefined' ? null : window.sessionStorage;
export const getReferralFlowToken = () => store()?.getItem(REFERRAL_FLOW_STORAGE_KEY) || '';
export const setReferralFlowToken = (token) => { const value = String(token || '').trim(); if (!value) return false; store()?.setItem(REFERRAL_FLOW_STORAGE_KEY, value); return true; };
export const clearReferralFlowToken = () => store()?.removeItem(REFERRAL_FLOW_STORAGE_KEY);
export const shouldClearReferralFlowToken = (result) => ['QUALIFIED','ALREADY_QUALIFIED','SELF_REFERRAL_NOT_ALLOWED','REFERRAL_FLOW_INVALID','REFERRAL_FLOW_EXPIRED','REFERRAL_FLOW_SCOPE_MISMATCH'].includes(String(result || ''));
export const applyReferralFlowTerminalResult = (result) => { if (shouldClearReferralFlowToken(result)) clearReferralFlowToken(); return String(result || ''); };