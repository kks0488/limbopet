function isValidUUID(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(str || ''));
}

function isValidPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function parseBool(val) {
  if (val === true || val === 'true' || val === '1') return true;
  return false;
}

module.exports = {
  isValidUUID,
  isValidPositiveInt,
  parseBool
};
