import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from './jwt-payload.interface';
import { resolveJwtSecret } from './jwt-secret';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: (req: any) => {
        if (!req || !req.headers) return null;
        const authHeader = req.headers['authorization'];
        if (!authHeader) return null;
        return authHeader.startsWith('Bearer ')
          ? authHeader.substring(7)
          : authHeader;
      },
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  validate(payload: JwtPayload) {
    return payload;
  }
}