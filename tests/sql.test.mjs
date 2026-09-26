import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteSql } from '../server/sql.mjs';

test('postgres SQL quotes camelCase columns and numbers placeholders', () => {
  assert.equal(
    rewriteSql('SELECT * FROM roster WHERE classId=? AND number=?'),
    'SELECT * FROM roster WHERE "classId"=$1 AND number=$2',
  );
  assert.equal(
    rewriteSql('SELECT "classId" FROM roster WHERE classId=?'),
    'SELECT "classId" FROM roster WHERE "classId"=$1',
  );
  assert.equal(
    rewriteSql('SELECT a.*, c.name className FROM attempts a WHERE s.sentAt IS NULL'),
    'SELECT a.*, c.name "className" FROM attempts a WHERE s."sentAt" IS NULL',
  );
  assert.equal(
    rewriteSql("SELECT COALESCE(a.status,'absent') status FROM attendance a WHERE a.classId=?"),
    `SELECT COALESCE(a.status,'absent') status FROM attendance a WHERE a."classId"=$1`,
  );
});
