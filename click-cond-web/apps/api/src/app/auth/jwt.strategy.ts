import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { resolveJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: (req: any) => {
        if (!req) return null;
        if (req.headers && req.headers['authorization']) {
          const authHeader = req.headers['authorization'];
          if (authHeader) {
            return authHeader.startsWith('Bearer ')
              ? authHeader.substring(7)
              : authHeader;
          }
        }
        if (req.query && req.query.token) {
          return req.query.token;
        }
        return null;
      },
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  validate(payload: JwtPayload) {
    return payload;
  }
}