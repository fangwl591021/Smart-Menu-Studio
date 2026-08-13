import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENAI_BUSINESS_CARD_MODEL,
  OPENAI_MEDIA_CLASSIFIER_MODEL,
  OPENAI_TRAVEL_POSTER_MODEL,
  PROMOTION_MEDIA_CLASSIFICATION_SCHEMA,
  parsePromotionMediaClassification,
  promotionExtractionInstruction,
  promotionExtractionModel,
} from '../src/ai/media-model-routing.ts';

test('media routing uses the low-cost model for classification and business cards', () => {
  assert.equal(OPENAI_MEDIA_CLASSIFIER_MODEL, 'gpt-5.6-terra');
  assert.equal(OPENAI_BUSINESS_CARD_MODEL, 'gpt-5.6-terra');
  assert.equal(parsePromotionMediaClassification('{"mediaType":"BUSINESS_CARD"}'), 'BUSINESS_CARD');
  assert.equal(promotionExtractionModel('BUSINESS_CARD'), 'gpt-5.6-terra');
  assert.match(promotionExtractionInstruction('BUSINESS_CARD', 'base'), /Leave travel-only fields empty or null/);
});

test('travel posters upgrade to the advanced model', () => {
  assert.equal(OPENAI_TRAVEL_POSTER_MODEL, 'gpt-5.6-sol');
  assert.equal(parsePromotionMediaClassification('{"mediaType":"TRAVEL_POSTER"}'), 'TRAVEL_POSTER');
  assert.equal(promotionExtractionModel('TRAVEL_POSTER'), 'gpt-5.6-sol');
  assert.match(promotionExtractionInstruction('TRAVEL_POSTER', 'base'), /all visible travel, itinerary, date, price/);
});

test('invalid or ambiguous classifier output safely upgrades instead of downgrading', () => {
  for (const output of ['', 'not-json', '{"mediaType":"OTHER"}', '{"mediaType":"BUSINESS_CARD","extra":true}']) {
    assert.equal(parsePromotionMediaClassification(output), 'TRAVEL_POSTER');
  }
  assert.deepEqual(PROMOTION_MEDIA_CLASSIFICATION_SCHEMA.required, ['mediaType']);
  assert.equal(PROMOTION_MEDIA_CLASSIFICATION_SCHEMA.additionalProperties, false);
});
