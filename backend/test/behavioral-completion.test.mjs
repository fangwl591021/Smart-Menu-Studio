import test from 'node:test';
import assert from 'node:assert/strict';
import { mappedMappableClickBoundsRatio } from '../src/guide/context.ts';

const rows = (mapped, total) => Array.from({ length: total }, (_, index) => ({ project_area_id: index < mapped ? `area-${index}` : '', bounds_width: 100, bounds_height: 100 }));
test('4F-2 mapped mappable click bounds blocks 79 percent', () => assert.equal(mappedMappableClickBoundsRatio(rows(79, 100)) >= .8, false));
test('4F-2 mapped mappable click bounds allows 80 percent', () => assert.equal(mappedMappableClickBoundsRatio(rows(80, 100)) >= .8, true));
test('4F-2 mapped mappable click bounds blocks zero denominator', () => assert.equal(mappedMappableClickBoundsRatio([{ project_area_id: 'summary', bounds_width: -1, bounds_height: -1 }]) >= .8, false));
