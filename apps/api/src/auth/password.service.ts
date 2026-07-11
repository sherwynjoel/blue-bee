import { Inject, Injectable } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { AUTH_CONFIG, type AuthConfig } from '../config/auth.config';

/**
 * [Inc-35] Password hashing at rest — bcrypt (cost from config, default 12). We NEVER store or log the
 * plaintext; only the salted bcrypt hash lives in `User.passwordHash`. `verify` uses bcrypt's
 * constant-time compare. Kept behind a service so the algorithm/cost is a single swap point.
 */
@Injectable()
export class PasswordService {
  constructor(@Inject(AUTH_CONFIG) private readonly config: AuthConfig) {}

  hash(plain: string): Promise<string> {
    return bcrypt.hash(plain, this.config.credential.bcryptRounds);
  }

  verify(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }
}
