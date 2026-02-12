function escapeILike(value) {
  return String(value || '').replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

module.exports = {
  escapeILike
};
