import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

/**
 * Validates a request payload against a Zod schema from @blue-bee/shared.
 * On failure throws 400 with the field errors (rendered as problem+json by the
 * global filter). Use as `@Body(new ZodBody(otpRequestSchema))`.
 */
export class ZodBody<T> implements PipeTransform {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const messages = result.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`);
      throw new BadRequestException({ error: 'validation_failed', message: messages });
    }
    return result.data;
  }
}
