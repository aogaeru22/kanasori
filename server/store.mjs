import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}
export function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':');
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(expected, 'hex'));
}
export function openStore(path) {
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
  `);
  return db;
}
