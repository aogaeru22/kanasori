import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import postgres from 'postgres';
import { rewriteSql } from './sql.mjs';
import { SCHEMA_STATEMENTS, TABLES } from './schema.mjs';

const require = createRequire(import.meta.url);

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
export function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(expected, 'hex'));
}
export function openStore(path) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (path !== ':memory:' && databaseUrl) return openPostgres(databaseUrl);
  return openSqlite(path);
}

function openSqlite(path) {
  const { DatabaseSync } = require('node:sqlite');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS teachers (id TEXT PRIMARY KEY, name TEXT NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS classes (id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS permissions (teacher TEXT REFERENCES teachers(id), classId TEXT REFERENCES classes(id), PRIMARY KEY(teacher,classId));
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, role TEXT NOT NULL, owner TEXT NOT NULL, classId TEXT, number TEXT, name TEXT, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, classId TEXT REFERENCES classes(id), number TEXT NOT NULL, name TEXT NOT NULL, lesson TEXT NOT NULL, target TEXT NOT NULL, heard TEXT NOT NULL, score INTEGER, passed INTEGER, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS roster (classId TEXT REFERENCES classes(id), number TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY(classId,number));
    CREATE TABLE IF NOT EXISTS attendance (classId TEXT, number TEXT, day TEXT, status TEXT NOT NULL CHECK(status IN ('present','absent')), updated TEXT NOT NULL, PRIMARY KEY(classId,number,day), FOREIGN KEY(classId,number) REFERENCES roster(classId,number));
    CREATE INDEX IF NOT EXISTS attempts_class ON attempts(classId,at);
    CREATE INDEX IF NOT EXISTS attempts_owner ON attempts(owner);
    CREATE TABLE IF NOT EXISTS recovery_emails (teacher TEXT PRIMARY KEY REFERENCES teachers(id), email TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_codes (teacher TEXT PRIMARY KEY REFERENCES teachers(id), hash TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sheet_receipts (id TEXT PRIMARY KEY REFERENCES attempts(id), sentAt TEXT NOT NULL);
  `);
  return wrapSqlite(db);
}

function wrapSqlite(db) {
  const store = {
    prepare: sql => db.prepare(sql),
    exec: sql => db.exec(sql),
    close: () => db.close(),
    async transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = await fn(store);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return store;
}

function wrapPostgres(sql, { end } = {}) {
  const store = {
    prepare(text) {
      const query = rewriteSql(text);
      return {
        async get(...args) {
          const rows = await sql.unsafe(query, args);
          return rows[0];
        },
        async all(...args) {
          return await sql.unsafe(query, args);
        },
        async run(...args) {
          await sql.unsafe(query, args);
        },
      };
    },
    async exec(text) {
      for (const part of text.split(';').map(item => item.trim()).filter(Boolean)) await sql.unsafe(rewriteSql(part));
    },
    async transaction(fn) {
      return sql.begin(async tx => fn(wrapPostgres(tx)));
    },
    async close() {
      if (end) await end();
    },
  };
  return store;
}

export function openPostgres(databaseUrl) {
  let sql;
  try {
    sql = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : 'require',
    });
  } catch (error) {
    console.error(error);
    return brokenStore(error);
  }
  const store = wrapPostgres(sql, { end: () => sql.end({ timeout: 5 }) });
  store.ready = migrate(sql).catch(error => {
    console.error(error);
    store.readyError = error;
  });
  return store;
}

function brokenStore(error) {
  const fail = async () => { throw error; };
  return {
    prepare() { return { get: fail, all: fail, run: fail }; },
    exec: fail,
    transaction: fail,
    async close() {},
    ready: Promise.resolve(),
    readyError: error,
  };
}

async function migrate(sql) {
  for (const statement of SCHEMA_STATEMENTS) await sql.unsafe(statement);
  for (const table of TABLES) {
    await sql.unsafe(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    try {
      await sql.unsafe(`REVOKE ALL ON TABLE ${table} FROM anon, authenticated`);
    } catch (error) {
      if (error.code !== '42704') throw error;
    }
  }
}
