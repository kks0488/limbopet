function hash32(text) {
  const s = String(text ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

async function tryAdvisoryLock(client, { namespace, key }) {
  const ns = Number(namespace) | 0;
  const k = hash32(key);
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1, $2) AS ok', [ns, k]);
  return Boolean(rows?.[0]?.ok);
}

async function advisoryUnlock(client, { namespace, key }) {
  const ns = Number(namespace) | 0;
  const k = hash32(key);
  await client.query('SELECT pg_advisory_unlock($1, $2)', [ns, k]);
}

module.exports = {
  hash32,
  tryAdvisoryLock,
  advisoryUnlock
};

