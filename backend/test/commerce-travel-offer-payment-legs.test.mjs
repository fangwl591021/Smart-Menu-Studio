import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyVerifiedPaymentLeg,
  commercePaymentLeg,
  paymentObligationPlan,
} from '../src/commerce/payment-obligations.ts';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
const [migration, commerce, obligations, offers, memberCommerce, entitlements, policy] = await Promise.all([
  read('../migrations/0050_commerce_travel_offer_payment_legs.sql'),
  read('../src/commerce/commerce.ts'),
  read('../src/commerce/payment-obligations.ts'),
  read('../src/commerce/travel-offer.ts'),
  read('../src/commerce/member-commerce.ts'),
  read('../src/modules/entitlements.ts'),
  read('../docs/8a-module-entitlement-policy.md'),
]);

const contracts = [
  ['0050 declares additive-only scope', migration, /Additive only; no backfill, seed data/],
  ['STANDARD is the product kind default', migration, /product_kind TEXT NOT NULL DEFAULT 'STANDARD'/],
  ['Travel departure offer kind is supported', migration, /'TRAVEL_DEPARTURE'/],
  ['source bridge table exists', migration, /CREATE TABLE IF NOT EXISTS commerce_product_sources/],
  ['one source maps to one offer', migration, /UNIQUE\(workspace_id,source_domain,source_reference\)/],
  ['one offer maps to one source', migration, /UNIQUE\(workspace_id,product_id\)/],
  ['offer source is immutable', migration, /commerce_product_sources_no_update/],
  ['tenant generic products exclude Travel', commerce, /WHERE workspace_id=\? AND product_kind='STANDARD'/],
  ['member generic products exclude Travel', memberCommerce, /status='ACTIVE' AND product_kind='STANDARD'/],
  ['Travel offer ensure is idempotent', offers, /ON CONFLICT\(id\) DO UPDATE SET/],
  ['Travel source ensure is idempotent', offers, /ON CONFLICT\(workspace_id,source_domain,source_reference\) DO NOTHING/],
  ['Travel offer status does not rewrite orders', offers, /^(?![\s\S]*(UPDATE|DELETE FROM) commerce_orders\b)/i],
  ['Travel source reference is scoped by workspace', offers, /s\.workspace_id=\?[^]*s\.source_domain='TRAVEL_DEPARTURE'/],
  ['Travel offer stays an explicit checkout kind', commerce, /productKind === 'TRAVEL_DEPARTURE'/],
  ['generic order defaults to STANDARD', commerce, /: 'STANDARD';/],
  ['FULL payment leg is supported', migration, /'FULL','DEPOSIT','BALANCE'/],
  ['payment intent records its leg', migration, /ALTER TABLE commerce_payment_intents[^]*ADD COLUMN payment_leg/],
  ['payment transaction records its leg', migration, /ALTER TABLE commerce_payment_transactions[^]*ADD COLUMN payment_leg/],
  ['durable obligation table exists', migration, /CREATE TABLE IF NOT EXISTS commerce_order_payment_obligations/],
  ['one obligation exists per order and leg', migration, /UNIQUE\(workspace_id,order_id,payment_leg\)/],
  ['paid obligation amount is exact', migration, /status='PAID' AND paid_amount_minor=amount_minor/],
  ['paid obligation is terminal', migration, /commerce_payment_obligation_paid_terminal/],
  ['intent reuse is scoped by order and leg', commerce, /order_id=\? AND payment_leg=\? AND status='PENDING'/],
  ['intent amount comes from obligation', commerce, /config\.mode,obligation\.amount_minor,paymentLeg/],
  ['generic browser input cannot choose amount or leg', commerce, /exactKeys\(input\.body,\[\],'COMMERCE_PAYMENT_INPUT_INVALID'\)/],
  ['generic Commerce payment remains FULL', commerce, /paymentLeg:'FULL'/],
  ['callback decrypts before intent resolution', commerce, /verifyCallback[^]*SELECT \* FROM commerce_payment_intents/],
  ['callback verifies configured MerchantID', commerce, /String\(data\.MerchantID\|\|''\)!==config\.merchantId/],
  ['callback verifies intent MerchantID', commerce, /String\(data\.MerchantID\|\|''\)===intent\.merchant_id/],
  ['callback verifies exact MerchantOrderNo', commerce, /merchantOrderNo!==String\(intent\.merchant_order_no\)/],
  ['callback verifies frozen intent amount', commerce, /amountValue===Number\(intent\.amount_minor\)/],
  ['callback verifies exact obligation scope', commerce, /obligation\.workspace_id!==intent\.workspace_id[^]*obligation\.order_id!==intent\.order_id/],
  ['verified settlement uses obligation authority', commerce, /applyVerifiedPaymentLeg/],
  ['settlement uses one D1 batch', obligations, /await db\.batch\(statements\)/],
  ['whole order paid only when all obligations are paid', obligations, /NOT EXISTS\([^]*o\.status<>'PAID'/],
  ['paid timestamp is set once', obligations, /paid_at=COALESCE\(paid_at,\?\)/],
  ['duplicate callback hash is idempotent', commerce, /callback_hash=\?[^]*idempotent:true/],
  ['duplicate provider transaction is idempotent', commerce, /provider_transaction_hash=\?[^]*idempotent:true/],
  ['late failed callback cannot revert PAID', commerce, /payment_status<>'PAID'/],
  ['DEPOSIT-only does not create conversion', `${commerce}\n${obligations}`, /^(?![\s\S]*INSERT INTO commerce_conversions)/i],
  ['settlement does not mutate Referral', `${commerce}\n${obligations}`, /^(?![\s\S]*(UPDATE|INSERT INTO) referral\w*\b)/i],
  ['settlement does not mutate Points or Rewards', `${commerce}\n${obligations}`, /^(?![\s\S]*(UPDATE|INSERT INTO) (points|rewards)\w*\b)/i],
  ['settlement does not mutate Commission or Payout', `${commerce}\n${obligations}`, /^(?![\s\S]*(UPDATE|INSERT INTO) (commission|payout)\w*\b)/i],
  ['settlement does not mutate CRM Stage', `${commerce}\n${obligations}`, /^(?![\s\S]*(UPDATE|INSERT INTO) crm\w*\b)/i],
  ['TRAVEL requires COMMERCE', entitlements, /TRAVEL: \['COMMERCE'\]/],
  ['TRAVEL does not require CRM', entitlements, /TRAVEL: \[(?![^\]]*'CRM')'COMMERCE'\]/],
  ['CRM is documented as recommended only', policy, /CRM is recommended[^.]*not a dependency/],
  ['obligation IDs are absent from public payment projections', `${commerce}\n${memberCommerce}`, /^(?![\s\S]*obligationId\s*:)/],
  ['Travel internal source IDs are absent from offer view', offers, /return \{[^}]*safeProductReference[^}]*productKind[^}]*(?!sourceReference)/],
  ['provider secrets are absent from public payment projections', `${commerce}\n${memberCommerce}`, /^(?![\s\S]*return \{[^}]*hash(Key|Iv))/i],
  ['raw callback payload has no persistence column', migration, /^(?![\s\S]*(trade_info|trade_sha|raw_callback))/i],
  ['0050 creates no Travel business table', migration, /^(?![\s\S]*CREATE TABLE(?: IF NOT EXISTS)? travel_(itineraries|departures|booking_extensions|booking_travelers))/i],
  ['0050 contains no DROP', migration, /^(?![\s\S]*\bDROP\b)/i],
  ['0050 contains no data backfill statement', migration, /^(?![\s\S]*^\s*(UPDATE|INSERT INTO commerce_(products|orders|payment_intents|payment_transactions))\b)/im],
];

for (const [name, source, pattern] of contracts) test(name, () => assert.match(source, pattern));

test('payment leg parser accepts all approved legs', () => {
  assert.deepEqual(['full', 'DEPOSIT', ' Balance '].map(commercePaymentLeg), ['FULL', 'DEPOSIT', 'BALANCE']);
});
test('payment leg parser rejects arbitrary values', () => assert.throws(() => commercePaymentLeg('INSTALLMENT'), /COMMERCE_PAYMENT_LEG_INVALID/));
test('ordinary Commerce defaults to one FULL obligation', () => assert.deepEqual(paymentObligationPlan(1200), [{ paymentLeg: 'FULL', amountMinor: 1200 }]));
test('explicit FULL must equal order total', () => assert.deepEqual(paymentObligationPlan(1200, [{ paymentLeg: 'FULL', amountMinor: 1200 }]), [{ paymentLeg: 'FULL', amountMinor: 1200 }]));
test('deposit and balance plan preserves server amounts', () => assert.deepEqual(paymentObligationPlan(1200, [{ paymentLeg: 'DEPOSIT', amountMinor: 300 }, { paymentLeg: 'BALANCE', amountMinor: 900 }]), [{ paymentLeg: 'DEPOSIT', amountMinor: 300 }, { paymentLeg: 'BALANCE', amountMinor: 900 }]));
test('payment plan rejects amount mismatch', () => assert.throws(() => paymentObligationPlan(1200, [{ paymentLeg: 'DEPOSIT', amountMinor: 300 }, { paymentLeg: 'BALANCE', amountMinor: 800 }]), /TOTAL_MISMATCH/));
test('payment plan rejects duplicate legs', () => assert.throws(() => paymentObligationPlan(1200, [{ paymentLeg: 'DEPOSIT', amountMinor: 300 }, { paymentLeg: 'DEPOSIT', amountMinor: 900 }]), /OBLIGATIONS_INVALID/));

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.replace(/\s+/g, ' ').trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async first() {
    if (this.sql.startsWith('SELECT id,total_amount_minor,status,payment_status FROM commerce_orders')) return this.db.order;
    if (this.sql.startsWith('SELECT id,workspace_id,order_id,payment_leg')) return this.db.obligations.get(`${this.values[0]}:${this.values[1]}:${this.values[2]}`) || null;
    if (this.sql.startsWith('SELECT status,payment_status FROM commerce_orders')) return { status: this.db.order.status, payment_status: this.db.order.payment_status };
    throw new Error(`Unexpected first: ${this.sql}`);
  }
  async run() {
    if (this.db.failOn && this.sql.includes(this.db.failOn)) throw new Error('SIMULATED_BATCH_FAILURE');
    if (this.sql.startsWith('INSERT INTO commerce_payment_transactions')) { this.db.transactions.push([...this.values]); return; }
    if (this.sql.startsWith('INSERT INTO commerce_order_payment_obligations')) {
      const [id, workspaceId, orderId, paymentLeg, amountMinor, createdAt] = this.values;
      const key = `${workspaceId}:${orderId}:${paymentLeg}`;
      if (!this.db.obligations.has(key)) this.db.obligations.set(key, { id, workspace_id: workspaceId, order_id: orderId, payment_leg: paymentLeg, amount_minor: amountMinor, currency_code: 'TWD', status: 'PENDING', paid_amount_minor: 0, paid_at: null, created_at: createdAt });
      return;
    }
    if (this.sql.startsWith('UPDATE commerce_order_payment_obligations')) {
      const [paidAt, id, workspaceId, orderId, paymentLeg] = this.values;
      const obligation = this.db.obligations.get(`${workspaceId}:${orderId}:${paymentLeg}`);
      if (obligation?.id === id && obligation.status === 'PENDING') Object.assign(obligation, { status: 'PAID', paid_amount_minor: obligation.amount_minor, paid_at: paidAt });
      return;
    }
    if (this.sql.startsWith('UPDATE commerce_payment_intents')) { this.db.intentStatus = 'PAID'; return; }
    if (this.sql.startsWith("UPDATE commerce_orders SET status='PAID'")) {
      const all = [...this.db.obligations.values()].filter(item => item.workspace_id === 'ws' && item.order_id === 'order');
      if (all.length && all.every(item => item.status === 'PAID') && this.db.order.payment_status !== 'PAID') Object.assign(this.db.order, { status: 'PAID', payment_status: 'PAID', paid_at: this.values[0] });
      return;
    }
    throw new Error(`Unexpected run: ${this.sql}`);
  }
}

class FakeDb {
  constructor(plan, { legacy = false } = {}) {
    this.order = { id: 'order', total_amount_minor: plan.reduce((sum, item) => sum + item.amountMinor, 0), status: 'PENDING_PAYMENT', payment_status: 'PENDING', paid_at: null };
    this.obligations = new Map(legacy ? [] : plan.map(item => [`ws:order:${item.paymentLeg}`, { id: `obl-${item.paymentLeg}`, workspace_id: 'ws', order_id: 'order', payment_leg: item.paymentLeg, amount_minor: item.amountMinor, currency_code: 'TWD', status: 'PENDING', paid_amount_minor: 0, paid_at: null }]));
    this.transactions = [];
    this.intentStatus = 'PENDING';
    this.batchCount = 0;
    this.failOn = null;
  }
  prepare(sql) { return new FakeStatement(this, sql); }
  async batch(statements) {
    this.batchCount += 1;
    const snapshot = structuredClone({ order: this.order, obligations: [...this.obligations], transactions: this.transactions, intentStatus: this.intentStatus });
    try { for (const statement of statements) await statement.run(); }
    catch (error) {
      this.order = snapshot.order;
      this.obligations = new Map(snapshot.obligations);
      this.transactions = snapshot.transactions;
      this.intentStatus = snapshot.intentStatus;
      throw error;
    }
  }
}

const transactionStatement = db => db.prepare('INSERT INTO commerce_payment_transactions test').bind('transaction');
const settle = (db, paymentLeg, verifiedAmountMinor) => applyVerifiedPaymentLeg(db, {
  workspaceId: 'ws', orderId: 'order', paymentIntentId: `intent-${paymentLeg}`, paymentLeg,
  verifiedAmountMinor, paidAt: '2026-08-11T00:00:00.000Z', transactionStatement: transactionStatement(db),
});

test('FULL settlement marks the order PAID', async () => {
  const db = new FakeDb([{ paymentLeg: 'FULL', amountMinor: 1000 }]);
  assert.equal((await settle(db, 'FULL', 1000)).fullyPaid, true);
  assert.equal(db.order.payment_status, 'PAID');
});
test('DEPOSIT settlement pays its obligation but not the whole order', async () => {
  const db = new FakeDb([{ paymentLeg: 'DEPOSIT', amountMinor: 300 }, { paymentLeg: 'BALANCE', amountMinor: 700 }]);
  assert.equal((await settle(db, 'DEPOSIT', 300)).fullyPaid, false);
  assert.equal(db.obligations.get('ws:order:DEPOSIT').status, 'PAID');
  assert.notEqual(db.order.payment_status, 'PAID');
});
test('BALANCE after DEPOSIT marks the whole order PAID', async () => {
  const db = new FakeDb([{ paymentLeg: 'DEPOSIT', amountMinor: 300 }, { paymentLeg: 'BALANCE', amountMinor: 700 }]);
  await settle(db, 'DEPOSIT', 300);
  assert.equal((await settle(db, 'BALANCE', 700)).fullyPaid, true);
});
test('BALANCE before DEPOSIT is rejected', async () => {
  const db = new FakeDb([{ paymentLeg: 'DEPOSIT', amountMinor: 300 }, { paymentLeg: 'BALANCE', amountMinor: 700 }]);
  await assert.rejects(() => settle(db, 'BALANCE', 700), /COMMERCE_PAYMENT_LEG_NOT_READY/);
  assert.notEqual(db.order.payment_status, 'PAID');
});
test('settlement amount mismatch is rejected', async () => {
  const db = new FakeDb([{ paymentLeg: 'FULL', amountMinor: 1000 }]);
  await assert.rejects(() => settle(db, 'FULL', 999), /COMMERCE_PAYMENT_CALLBACK_MISMATCH/);
});
test('legacy FULL obligation is created inside the settlement batch', async () => {
  const db = new FakeDb([{ paymentLeg: 'FULL', amountMinor: 1000 }], { legacy: true });
  assert.equal((await settle(db, 'FULL', 1000)).fullyPaid, true);
  assert.equal(db.batchCount, 1);
  assert.equal(db.obligations.get('ws:order:FULL').status, 'PAID');
});
test('failed D1 batch leaves no partial settlement state', async () => {
  const db = new FakeDb([{ paymentLeg: 'FULL', amountMinor: 1000 }]);
  db.failOn = 'UPDATE commerce_order_payment_obligations';
  await assert.rejects(() => settle(db, 'FULL', 1000), /SIMULATED_BATCH_FAILURE/);
  assert.equal(db.transactions.length, 0);
  assert.equal(db.obligations.get('ws:order:FULL').status, 'PENDING');
  assert.notEqual(db.order.payment_status, 'PAID');
});
