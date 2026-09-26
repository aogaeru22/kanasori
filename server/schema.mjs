export const TABLES = [
  'teachers',
  'classes',
  'permissions',
  'sessions',
  'attempts',
  'roster',
  'attendance',
  'recovery_emails',
  'recovery_codes',
  'sheet_receipts',
];

// Column order matches the positional INSERT statements used by the app.
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS teachers (
    id text PRIMARY KEY,
    name text NOT NULL,
    password text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS classes (
    id text PRIMARY KEY,
    name text NOT NULL,
    code text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS permissions (
    teacher text REFERENCES teachers(id),
    "classId" text REFERENCES classes(id),
    PRIMARY KEY (teacher, "classId")
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token text PRIMARY KEY,
    role text NOT NULL,
    owner text NOT NULL,
    "classId" text,
    number text,
    name text,
    expires bigint NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS attempts (
    id text PRIMARY KEY,
    owner text NOT NULL,
    "classId" text REFERENCES classes(id),
    number text NOT NULL,
    name text NOT NULL,
    lesson text NOT NULL,
    target text NOT NULL,
    heard text NOT NULL,
    score integer,
    passed integer,
    at text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS roster (
    "classId" text REFERENCES classes(id),
    number text NOT NULL,
    name text NOT NULL,
    PRIMARY KEY ("classId", number)
  )`,
  `CREATE TABLE IF NOT EXISTS attendance (
    "classId" text,
    number text,
    day text,
    status text NOT NULL CHECK (status IN ('present', 'absent')),
    updated text NOT NULL,
    PRIMARY KEY ("classId", number, day),
    FOREIGN KEY ("classId", number) REFERENCES roster ("classId", number)
  )`,
  `CREATE INDEX IF NOT EXISTS attempts_class ON attempts ("classId", at)`,
  `CREATE INDEX IF NOT EXISTS attempts_owner ON attempts (owner)`,
  `CREATE TABLE IF NOT EXISTS recovery_emails (
    teacher text PRIMARY KEY REFERENCES teachers(id),
    email text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS recovery_codes (
    teacher text PRIMARY KEY REFERENCES teachers(id),
    hash text NOT NULL,
    expires bigint NOT NULL,
    tries integer NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sheet_receipts (
    id text PRIMARY KEY REFERENCES attempts(id),
    "sentAt" text NOT NULL
  )`,
];
