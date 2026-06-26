import { Logger, Module } from '@nestjs/common';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';
import { OrdersModule } from '../orders/orders.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PAYMENTS_CONFIG, loadPaymentsConfig, type PaymentsConfig } from '../config/payments.config';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider';
import { StripePaymentProvider } from './provider/stripe-payment.provider';
import { LocalPaymentProvider } from './provider/local-payment.provider';
import { StripeEventVerifier } from './provider/stripe-event.verifier';
import { PaymentService } from './payment.service';
import { BillingService } from './billing.service';
import { RefundService } from './refund.service';
import { DisputeService } from './dispute.service';
import { StripeWebhookService } from './webhook.service';
import { PaymentsController } from './payments.controller';
import { StripeWebhookController } from './webhook.controller';

/**
 * Payments / billing module (Increment 12, BUILD-PLAN — the "bill" leg). The Stripe billing rail:
 * PaymentIntents (take-payment) + the signature-verified, idempotent webhook (the source of truth) +
 * Payment/Invoice/Refund/Dispute state machines + receipts/dunning/dispute alerts through the Inc-8
 * engine. TEST MODE ONLY.
 *
 * The OUTBOUND provider is env-selected by STRIPE_SECRET_KEY: the real `stripe` SDK
 * (StripePaymentProvider) in production, else the deterministic no-network LocalPaymentProvider so
 * the whole rail runs headlessly. Inbound signature verification (StripeEventVerifier) is always
 * real. Reuses OrdersModule (state machine + parent-ownership gate + audit) + NotificationsModule.
 */
@Module({
  imports: [OrdersModule, NotificationsModule],
  controllers: [PaymentsController, StripeWebhookController],
  providers: [
    { provide: PAYMENTS_CONFIG, useFactory: loadPaymentsConfig },
    {
      provide: PAYMENT_PROVIDER,
      inject: [PAYMENTS_CONFIG],
      useFactory: (cfg: PaymentsConfig): PaymentProvider => {
        const logger = new Logger('PaymentsModule');
        if (cfg.stripe.secretKey) {
          logger.log('payments: outbound provider = stripe (real SDK, test mode)');
          return new StripePaymentProvider(cfg);
        }
        logger.warn('payments: STRIPE_SECRET_KEY absent → LocalPaymentProvider (deterministic, no network). Inbound signature verification is still REAL.');
        return new LocalPaymentProvider();
      },
    },
    StripeEventVerifier,
    PaymentService,
    BillingService,
    RefundService,
    DisputeService,
    StripeWebhookService,
    IdempotencyInterceptor,
  ],
  // Exported so the e2e + headless integration proof can sign genuine test events with the shared secret.
  exports: [StripeEventVerifier],
})
export class PaymentsModule {}
