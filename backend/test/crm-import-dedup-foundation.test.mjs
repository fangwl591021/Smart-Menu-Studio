import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyImportMatch, importCapability, parseCsvCandidateRows, validateImportCandidate } from '../src/crm/imports.ts';

test('CSV candidates use strict field allowlists and never map economy or identity columns',()=>{
 const parsed=parseCsvCandidateRows('contactName,mobile,email,points,line_uid\nAda,+886 912-345-678,ADA@EXAMPLE.COM,999,U123');
 assert.equal(parsed.rows.length,1); assert.equal(parsed.rows[0].candidate.contactName,'Ada'); assert.equal(parsed.rows[0].candidate.points,undefined);
 assert.deepEqual(validateImportCandidate(parsed.rows[0].candidate),{valid:true,normalizedMobile:'+886912345678',normalizedEmail:'ada@example.com'});
 assert.ok(parsed.warnings.some(x=>x.startsWith('PROHIBITED_COLUMN:points')));
});
test('exact contacts link, name company requires review, and conflicting contacts require merge review',()=>{
 assert.deepEqual(classifyImportMatch({normalizedMobile:'1',normalizedEmail:'2'},{mobilePersonId:'a',emailPersonId:'a'}).status,'READY_LINK');
 assert.deepEqual(classifyImportMatch({normalizedMobile:'1',normalizedEmail:'2'},{mobilePersonId:'a',emailPersonId:'b'}).status,'MERGE_REVIEW_REQUIRED');
 assert.deepEqual(classifyImportMatch({normalizedMobile:'',normalizedEmail:'',contactName:'Ada',companyName:'Acme'},{}).status,'MATCH_CANDIDATE');
 assert.deepEqual(classifyImportMatch({normalizedMobile:'',normalizedEmail:''},{}).status,'READY_CREATE');
});
test('OCR and XLSX have explicit pending capability boundaries without fake success',()=>{
 assert.deepEqual(importCapability('CSV'),{available:true,code:'CSV_READY'});
 assert.deepEqual(importCapability('XLSX'),{available:false,code:'XLSX_PARSER_PENDING'});
 assert.deepEqual(importCapability('BUSINESS_CARD_OCR'),{available:false,code:'OCR_PROVIDER_ADAPTER_PENDING'});
});