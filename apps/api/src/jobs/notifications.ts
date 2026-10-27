/**
 * Notification interface with a console/log implementation.
 *
 * README section: "Operations and monitoring"
 *   "notify funders (and schools) as expiry approaches, using a notification
 *    interface with a console/log implementation (no live SMS or WhatsApp
 *    this sprint)."
 *
 * A real implementation would look up an email or push address from the
 * users table and dispatch via a mail/push service.  That is deferred.
 */

import { logger } from '../logger';

export interface VoucherNotification {
  voucherId: string;
  /** ISO-8601 string */
  expiresAt: string;
  /** Stellar address */
  recipientAddress: string;
  role: 'funder' | 'school';
  hoursRemaining: number;
}

export interface NotificationProvider {
  send(notification: VoucherNotification): Promise<void>;
}

/**
 * LogNotificationProvider — writes a structured log line.
 * Used in all environments until a real provider is wired up.
 */
export class LogNotificationProvider implements NotificationProvider {
  async send(n: VoucherNotification): Promise<void> {
    logger.info(
      {
        event: 'voucher_expiry_reminder',
        voucherId: n.voucherId,
        expiresAt: n.expiresAt,
        role: n.role,
        hoursRemaining: n.hoursRemaining,
        // Do NOT log the recipientAddress in a way that pairs it with a
        // student identifier — we log the address only for operational
        // awareness.
        recipientAddress: n.recipientAddress,
      },
      `Expiry reminder: voucher ${n.voucherId} expires in ~${n.hoursRemaining}h`,
    );
  }
}

export function createNotificationProvider(): NotificationProvider {
  // Future: check NOTIFICATION_PROVIDER env var and return SMS/email impl.
  return new LogNotificationProvider();
}
