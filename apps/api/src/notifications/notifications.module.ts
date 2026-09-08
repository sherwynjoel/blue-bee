import { Module } from '@nestjs/common';
import { NOTIFICATIONS_CONFIG, loadNotificationsConfig } from '../config/notifications.config';
import { NOTIFICATION_TRANSPORTS, type TransportRegistry } from './transports/notification-transport';
import { SmsNotificationTransport } from './transports/sms.transport';
import { EmailNotificationTransport } from './transports/email.transport';
import { PushNotificationTransport } from './transports/push.transport';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationPreferencesService } from './notification-preferences.service';
import { NotificationProcessor } from './notification-processor.service';
import { NotificationService } from './notification.service';
import { DeviceTokenService } from './device-token.service';
import { DeviceTokenController } from './device-token.controller';
import { IdempotencyInterceptor } from '../common/idempotency.interceptor';

/**
 * Notifications module (Increment 8, BUILD-PLAN — §8.5/§17.2 notification engine). Turns the durable
 * GeofenceEvent rows + `eta`/`geofence` realtime events (Increment 7) into customer alerts: a
 * matrix-driven engine (recipient resolution → §17.2 matrix → preferences/quiet-hours → outbox with
 * idempotency + retry) delivering across three REAL transports behind the `NOTIFICATION_TRANSPORTS`
 * seam — SMS (reuses the Increment-2 `SMS_TRANSPORT`/Twilio), Email (SendGrid sandbox), Push (Expo),
 * each with a real local console fallback. Also exposes `POST/DELETE /v1/device-tokens`.
 *
 * Exports `NotificationService` so the tracking layer (TrackingPredictionService) can dispatch on a
 * genuine geofence crossing — degradation-wrapped, so a notification failure never fails ingestion,
 * the geofence write, or a §5.4 transition. Reuses the global PrismaModule + SmsModule (Increment 2).
 */
@Module({
  controllers: [DeviceTokenController],
  providers: [
    { provide: NOTIFICATIONS_CONFIG, useFactory: loadNotificationsConfig },
    SmsNotificationTransport,
    EmailNotificationTransport,
    PushNotificationTransport,
    {
      provide: NOTIFICATION_TRANSPORTS,
      inject: [SmsNotificationTransport, EmailNotificationTransport, PushNotificationTransport],
      useFactory: (
        sms: SmsNotificationTransport,
        email: EmailNotificationTransport,
        push: PushNotificationTransport,
      ): TransportRegistry => {
        const registry: TransportRegistry = new Map();
        registry.set(sms.channel, sms);
        registry.set(email.channel, email);
        registry.set(push.channel, push);
        return registry;
      },
    },
    NotificationRecipientsService,
    NotificationPreferencesService,
    NotificationProcessor,
    NotificationService,
    DeviceTokenService,
    IdempotencyInterceptor,
  ],
  exports: [NotificationService, NotificationProcessor],
})
export class NotificationsModule {}
