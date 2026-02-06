const { extractToken } = require('../utils/auth');
const { UnauthorizedError } = require('../utils/errors');
const { verifyUserToken } = require('../utils/jwt');
const UserService = require('../services/UserService');

async function requireUserAuth(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = extractToken(authHeader);

    if (!token) {
      throw new UnauthorizedError(
        'No authorization token provided',
        "Add 'Authorization: Bearer YOUR_USER_JWT' header"
      );
    }

    const payload = verifyUserToken(token);
    const userId = payload?.sub;

    if (!userId) {
      throw new UnauthorizedError('Invalid token', 'Re-authenticate and try again');
    }

    const user = await UserService.findById(userId);
    req.user = user;
    req.userToken = token;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  requireUserAuth
};

