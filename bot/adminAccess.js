const crypto = require('node:crypto');

const ADMIN_COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const BLOCK_DURATION_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const CHANNEL_ID_PATTERN = /^\d{17,20}$/;

class AdminAccess {
  constructor({ getAdminCode, getSessionSecret }) {
    this.getAdminCode = getAdminCode;
    this.getSessionSecret = getSessionSecret;
    this.failedAttempts = new Map();
    this.sessions = new Map();
  }

  classifyEntry(value, ip) {
    const candidate = String(value || '').trim();
    const expected = String(this.getAdminCode() || '').trim();
    const isAdmin = this._safeCompare(candidate, expected);
    const now = Date.now();
    const attempts = this.failedAttempts.get(ip);
    const blocked = attempts?.blockedUntil > now;

    if (blocked) return 'normal';
    if (isAdmin && expected) {
      this.failedAttempts.delete(ip);
      return 'admin';
    }

    // Valid-looking Discord IDs are normal channel requests, not failed code guesses.
    if (!CHANNEL_ID_PATTERN.test(candidate)) this._recordFailure(ip, now);
    return 'normal';
  }

  createSession() {
    const secret = this.getSessionSecret();
    if (!secret) throw new Error('Admin sessions are not configured.');

    const sessionId = crypto.randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + SESSION_TTL_MS;
    const payload = Buffer.from(JSON.stringify({ sessionId, expiresAt })).toString('base64url');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');

    this._removeExpiredSessions();
    this.sessions.set(sessionId, expiresAt);
    return {
      token: `${payload}.${signature}`,
      maxAge: SESSION_TTL_MS,
      sessionId,
      expiresAt,
    };
  }

  sessionIdFromCookieHeader(cookieHeader) {
    const token = this._readCookie(cookieHeader, ADMIN_COOKIE_NAME);
    if (!token) return null;

    const [payload, signature, extra] = token.split('.');
    const secret = this.getSessionSecret();
    if (!payload || !signature || extra || !secret) return null;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest();
    const receivedSignature = Buffer.from(signature, 'base64url');
    if (
      receivedSignature.length !== expectedSignature.length
      || !crypto.timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      return null;
    }

    try {
      const { sessionId, expiresAt } = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8')
      );
      const storedExpiry = this.sessions.get(sessionId);
      if (
        typeof sessionId !== 'string'
        || typeof expiresAt !== 'number'
        || expiresAt <= Date.now()
        || storedExpiry !== expiresAt
      ) {
        if (sessionId) this.sessions.delete(sessionId);
        return null;
      }
      return sessionId;
    } catch {
      return null;
    }
  }

  requireAdmin = (req, res, next) => {
    const sessionId = this.sessionIdFromCookieHeader(req.headers.cookie);
    if (!sessionId) {
      return res.status(401).json({ error: 'Admin authentication required.' });
    }
    req.adminSessionId = sessionId;
    return next();
  };

  revokeSession(sessionId) {
    this.sessions.delete(sessionId);
  }

  static cookieName() {
    return ADMIN_COOKIE_NAME;
  }

  static sessionTtl() {
    return SESSION_TTL_MS;
  }

  static isChannelId(value) {
    return CHANNEL_ID_PATTERN.test(String(value || '').trim());
  }

  _safeCompare(candidate, expected) {
    const candidateHash = crypto.createHash('sha256').update(candidate).digest();
    const expectedHash = crypto.createHash('sha256').update(expected).digest();
    return expected.length > 0 && crypto.timingSafeEqual(candidateHash, expectedHash);
  }

  _recordFailure(ip, now) {
    const current = this.failedAttempts.get(ip) || { count: 0, blockedUntil: 0 };
    current.count += 1;
    current.lastAttemptAt = now;
    if (current.count >= MAX_FAILED_ATTEMPTS) {
      current.count = 0;
      current.blockedUntil = now + BLOCK_DURATION_MS;
    }
    this.failedAttempts.set(ip, current);

    if (this.failedAttempts.size > 1000) {
      for (const [address, attempts] of this.failedAttempts) {
        if (now - (attempts.lastAttemptAt || 0) > ATTEMPT_WINDOW_MS) {
          this.failedAttempts.delete(address);
        }
      }
    }
  }

  _removeExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(sessionId);
    }
  }

  _readCookie(cookieHeader, name) {
    for (const part of String(cookieHeader || '').split(';')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      if (part.slice(0, separator).trim() !== name) continue;
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

module.exports = AdminAccess;
