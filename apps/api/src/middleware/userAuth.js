const { extractToken } = require('../utils/auth');
const { UnauthorizedError, NotFoundError } = require('../utils/errors');
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

    let payload = null;
    try {
      payload = verifyUserToken(token);
    } catch {
      throw new UnauthorizedError('Invalid token', 'Re-authenticate and try again');
    }
    const userId = payload?.sub;

    if (!userId) {
      throw new UnauthorizedError('Invalid token', 'Re-authenticate and try again');
    }

    let user = null;
    try {
      user = await UserService.findById(userId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        throw new UnauthorizedError('Invalid token', 'Re-authenticate and try again');
      }
      throw err;
    }
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
