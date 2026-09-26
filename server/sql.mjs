const IDENTIFIERS = ['classId', 'sentAt', 'className'];

// SQLite uses ? and unquoted camelCase. Postgres needs $1 and quoted identifiers.
export function rewriteSql(sql) {
  const quoted = sql.replace(new RegExp(`(?<!")\\b(${IDENTIFIERS.join('|')})\\b(?!")`, 'g'), '"$1"');
  let index = 0;
  return quoted.replace(/\?/g, () => `$${++index}`);
}
