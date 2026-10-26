/**
 * Authentication middleware.
 *
 * README section: "Tech stack" — OIDC/OAuth-compatible auth.
 *
 * Verifies a JWT issued by the OIDC provider (or the local dev provider).
 * Attaches the decoded user to req.user.
 *
 * The JWT must contain:
 *   sub      — OIDC subject (matched to users.oidc_subject)
 *   role     — user_role enum value
 *   userId   — internal UUID from users table
 *   schoolId (optional) — for school_admin role
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthUser {
  id: string;
  sub: string;
  role: 'funder' | 'school_admin' | 'attester' | 'platform_admin';
  schoolId?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'missing_token' });
    return;
  }
  const token = header.slice(7);
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'auth_misconfigured' });
    return;
  }
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    req.user = {
      id: payload['userId'] as string,
      sub: payload['sub'] as string,
      role: payload['role'] as AuthUser['role'],
      schoolId: payload['schoolId'] as string | undefined,
    };
    next();
  } catch {
    res.status(401).json({ error: 'invalid_token' });
  }
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
