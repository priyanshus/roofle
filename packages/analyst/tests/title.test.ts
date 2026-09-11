import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteClient } from '../src/db/index.js';

function makeClient(): SqliteClient {
  return new SqliteClient(':memory:');
}

test('setTitle stores and getTitle retrieves a one-line title', () => {
  const db = makeClient();
  try {
    assert.equal(db.getTitle('s1'), null);

    db.upsertSummary('s1', 'User discussed the Q3 enterprise pricing with the vendor.');
    db.setTitle('s1', 'Negotiating Q3 enterprise pricing');

    assert.equal(db.getTitle('s1'), 'Negotiating Q3 enterprise pricing');
  } finally {
    db.close();
  }
});

test('upsertSummary preserves an existing title when summary is updated', () => {
  const db = makeClient();
  try {
    db.upsertSummary('s1', 'First summary');
    db.setTitle('s1', 'Existing title');

    // Simulate a later rolling-summary update; the title must survive.
    db.upsertSummary('s1', 'Updated summary');

    assert.equal(db.getSummary('s1'), 'Updated summary');
    assert.equal(db.getTitle('s1'), 'Existing title');
  } finally {
    db.close();
  }
});

test('getSessions includes the generated title via LEFT JOIN', () => {
  const db = makeClient();
  try {
    db.touchSession('s-with-title');
    db.upsertSummary('s-with-title', 'summary text');
    db.setTitle('s-with-title', 'My conversation title');

    db.touchSession('s-no-title');

    const sessions = db.getSessions();
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));

    assert.equal(byId.get('s-with-title')?.title, 'My conversation title');
    assert.equal(byId.get('s-no-title')?.title, undefined);
    assert.equal(byId.get('s-no-title')?.questionCount, 0);
  } finally {
    db.close();
  }
});

test('getSession includes the title for the detail view', () => {
  const db = makeClient();
  try {
    db.touchSession('s1');
    db.upsertSummary('s1', 'summary text');
    db.setTitle('s1', 'Negotiating Q3 pricing');

    const detail = db.getSession('s1');
    assert.ok(detail);
    assert.equal(detail.title, 'Negotiating Q3 pricing');

    db.touchSession('s-no-title');
    const plain = db.getSession('s-no-title');
    assert.ok(plain);
    assert.equal(plain.title, undefined);
  } finally {
    db.close();
  }
});
