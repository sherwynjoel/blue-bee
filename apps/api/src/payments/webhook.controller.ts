import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/rbac/decorators';
import { StripeWebhookService } from './webhook.service';

/**
 * Stripe webhook (Increment 12) — the inbound source of truth. @Public (no JWT — authenticity is the
 * signature, not a bearer token) and reads the RAW request body (`NestFactory({ rawBody: true })`
 * captures it) so the signature can be verified against the exact bytes Stripe signed. The route is
 * deliberately a SLASH path (the Inc-9 path-to-regexp lesson for new routes).
 */
@Controller('webhooks')
export class StripeWebhookController {
  constructor(private readonly webhooks: StripeWebhookService) {}

  @Post('stripe')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  handleStripe(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string) {
    // req.rawBody is the unparsed Buffer (rawBody:true). Verification + idempotent processing happen
    // in the service; a bad signature → 400, a redelivery → a no-op 200.
    const raw = req.rawBody ?? Buffer.from('');
    return this.webhooks.handle(raw, signature);
  }
}
