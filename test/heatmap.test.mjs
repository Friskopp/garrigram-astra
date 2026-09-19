import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapPosts, densityField } from '../public/heatmap.mjs';

test('map periods use posting time and reject missing or invalid locations', () => {
  const now = Date.parse('2026-09-19T16:00:00Z');
  const photo = (id, age, lat = 0, lng = 0) => ({ id, lat, lng, created_at: new Date(now - age * 86400000).toISOString() });
  const posts = [photo('now', 0), photo('boundary', 1), photo('week', 6), photo('month', 29), photo('old', 40), photo('future', -1), photo('missing', 0, null), photo('invalid', 0, 91)];
  assert.deepEqual(mapPosts(posts, 'day', now).map(p => p.id), ['now', 'boundary']);
  assert.equal(mapPosts(posts, 'week', now).length, 3);
  assert.equal(mapPosts(posts, 'month', now).length, 4);
  assert.equal(mapPosts(posts, 'all', now).length, 6);
  assert.equal(mapPosts([{ lat: 0, lng: 0, created_at: 'invalid' }], 'day', now).length, 0);
});

test('density adds overlapping photos, preserves intensity when panning and clears empty periods', () => {
  const single = densityField([[20, 20]], 50, 50, 10);
  const many = densityField(Array(10).fill([20, 20]), 50, 50, 10);
  assert.equal(single[20 * 50 + 20], 1);
  assert.equal(many[20 * 50 + 20], 10);
  assert.equal(single[0], 0);
  assert.ok(single[20 * 50 + 25] < single[20 * 50 + 20]);
  const edge = densityField([[0, 20]], 50, 50, 10);
  assert.equal(edge[20 * 50], single[20 * 50 + 20]);
  assert.equal(densityField([], 50, 50).some(value => value !== 0), false);
  assert.equal(densityField([[200, 200]], 50, 50).some(value => value !== 0), false);
});
