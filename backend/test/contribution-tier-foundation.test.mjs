import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isContributionEventType,
  isTierCode,
} from '../src/contribution/index.ts';

const migrationUrl = new URL('../migrations/0034_contribution_tier_foundation.sql', import.meta.url);
const serviceUrl = new URL('../src/contribution/index.ts', import.meta.url);
const indexUrl = new URL('../src/index.ts', import.meta.url);

test('0034 is additive and creates the append-only contribution and tier history domain', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const required of [
    'CREATE TABLE IF NOT EXISTS member_contribution_events',
    'CREATE TABLE IF NOT EXISTS contribution_rule_versions',
    'CREATE TABLE IF NOT EXISTS member_tier_rule_versions',
    'CREATE TABLE IF NOT EXISTS member_tier_qualification_events',
    'UNIQUE(workspace_id,line_account_id,source_type,source_ref)',
    'CONTRIBUTION_EVENTS_APPEND_ONLY',
    'CONTRIBUTION_RULE_IMMUTABLE',
    'TIER_RULE_IMMUTABLE',
    'TIER_QUALIFICATION_APPEND_ONLY',
  ]) assert.equal(sql.includes(required), true);
  assert.doesNotMatch(sql, /(?:^|;)\s*(?:ALTER TABLE|DROP TABLE|UPDATE\s+(?!sqlite_)|DELETE\s+FROM)\b/im);
});

test('only audited server-trusted contribution event types and fixed tier codes are accepted', () => {
  for (const value of ['QUALIFIED_REFERRAL', 'VERIFIED_REFERRAL_CONVERSION', 'COMPLETED_REWARD_REDEMPTION']) assert.equal(isContributionEventType(value), true);
  for (const value of ['PAGE_VIEW', 'WEBHOOK', 'MANUAL_ADJUSTMENT', 'POINTS_CREDIT']) assert.equal(isContributionEventType(value), false);
  for (const value of ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM']) assert.equal(isTierCode(value), true);
  for (const value of ['DIAMOND', 'NO_TIER', '']) assert.equal(isTierCode(value), false);
});

test('contribution source authority resolves only business truth and preserves source uniqueness', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  for (const required of [
    'member_referral_attributions',
    'conversion_referral_evidence',
    'point_redemptions',
    "status='qualified'",
    "status='COMPLETED'",
    "e.evidence_type='SERVER_CONTEXT'",
    'effective_from<=?',
  ]) assert.equal(source.includes(required), true);
  assert.doesNotMatch(source, /manual|page.?view|webhook|journey/i);
  const migration = await readFile(migrationUrl, 'utf8');
  assert.match(migration, /UNIQUE\(workspace_id,line_account_id,source_type,source_ref\)/);
});

test('historical score and tier resolution are derived from append-only history, not mutable balances or point balances', async () => {
  const source = await readFile(serviceUrl, 'utf8');
  assert.match(source, /SUM\(score_delta\)/);
  assert.match(source, /member_tier_qualification_events/);
  assert.match(source, /historicalRank >= currentRank/);
  assert.match(source, /score >= rule\.minContributionScore/);
  assert.doesNotMatch(source, /UPDATE\s+member_contribution_events|DELETE\s+FROM\s+member_contribution_events|point_balance|cash|commission|payout/i);
});

test('tenant and member routes enforce roles, workspace scope, verified LIFF identity, and safe member history', async () => {
  const source = await readFile(indexUrl, 'utf8');
  for (const route of [
    "app.get('/api/contribution-rules'", "app.post('/api/contribution-rules'",
    "app.get('/api/tier-rules'", "app.post('/api/tier-rules'",
    "app.get('/api/contribution-summary'", "app.get('/api/member/contribution'",
  ]) assert.equal(source.includes(route), true);
  const memberSlice = source.slice(source.indexOf("app.get('/api/member/contribution'"), source.indexOf('function pointsRouteError'));
  assert.match(memberSlice, /verifiedReferralMember/);
  assert.doesNotMatch(memberSlice, /c\.req\.query\('memberId'\)|body\.memberId|body\.sourceRef/i);
  const ruleSlice = source.slice(source.indexOf("app.get('/api/contribution-rules'"), source.indexOf('function pointsRouteError'));
  assert.match(ruleSlice, /requireRole\(c,'viewer'\)/);
  assert.match(ruleSlice, /requireRole\(c,'admin'\)/);
});

test('trusted-source hooks are fail-safe and do not alter referral, conversion, reward, or point business truth', async () => {
  const index = await readFile(indexUrl, 'utf8');
  const rewards = await readFile(new URL('../src/points/rewards.ts', import.meta.url), 'utf8');
  assert.match(index, /eventType:'QUALIFIED_REFERRAL'.*?\.catch\(\(\)=>\{\}\)/s);
  assert.match(index, /eventType:'VERIFIED_REFERRAL_CONVERSION'/);
  assert.match(rewards, /eventType:'COMPLETED_REWARD_REDEMPTION'.*?\.catch\(\(\)=>\{\}\)/s);
  assert.doesNotMatch(index, /manual.*contribution|tier override/i);
});
