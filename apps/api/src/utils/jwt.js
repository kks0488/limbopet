const jwt = require('jsonwebtoken');
const config = require('../config');

function signUser(user) {
  return jwt.sign(
    {
      sub: user.id,
      provider: user.provider,
      email: user.email || undefined
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

function verifyUserToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

module.exports = {
  signUser,
  verifyUserToken
};

