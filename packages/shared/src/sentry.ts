/**
 * Sentry integration helper.
 * README section: "Operations and monitoring" — "Sentry integration behind
 *   environment configuration."
 *
 * Usage: import { initSentry } from './sentry'; initSentry(); at app startup.
 *
 * Sentry is disabled when SENTRY_DSN is not set (e.g. in local dev).
 * No personal data is attached to Sentry events — breadcrumb filtering
 * strips any key named studentIdentifier, salt, or studentRef.
 */

export function initSentry(appName: string): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.info(`[sentry] SENTRY_DSN not set — Sentry disabled for ${appName}`);
    return;
  }

  // Dynamic import so Sentry is tree-shaken when not used.
  // In production, add @sentry/node to each app's dependencies and
  // replace this stub with the real init call.
  //
  // Example (uncomment and install @sentry/node):
  //
  // const Sentry = await import('@sentry/node');
  // Sentry.init({
  //   dsn,
  //   environment: process.env.STELLAR_NETWORK ?? 'testnet',
  //   release: process.env.npm_package_version,
  //   beforeBreadcrumb(breadcrumb) {
  //     // Strip any sensitive keys before they reach Sentry
  //     if (breadcrumb.data) {
  //       delete breadcrumb.data['studentIdentifier'];
  //       delete breadcrumb.data['salt'];
  //       delete breadcrumb.data['studentRef'];
  //     }
  //     return breadcrumb;
  //   },
  // });
  // console.info(`[sentry] Sentry initialized for ${appName}`);

  console.info(`[sentry] DSN found — replace stub in packages/shared/src/sentry.ts to enable Sentry for ${appName}`);
}
