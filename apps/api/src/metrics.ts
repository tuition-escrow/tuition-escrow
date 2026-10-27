/**
 * Prometheus metrics for the API.
 * README section: "Operations and monitoring"
 */

import { Registry, Counter, Gauge, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: 'api' });

collectDefaultMetrics({ register: metricsRegistry });

export const httpRequestsCounter = new Counter({
  name: 'api_http_requests_total',
  help: 'Total HTTP requests handled by the API',
  labelNames: ['method', 'route', 'status_code'],
  registers: [metricsRegistry],
});

export const vouchersByStatusGauge = new Gauge({
  name: 'api_vouchers_by_status',
  help: 'Current count of vouchers by status (refreshed on scrape)',
  labelNames: ['status'],
  registers: [metricsRegistry],
});

export const sponsorBalanceGauge = new Gauge({
  name: 'api_sponsor_balance_stroops',
  help: 'Fee-sponsor account XLM balance in stroops',
  registers: [metricsRegistry],
});

export const adminFunctionInvocationsCounter = new Counter({
  name: 'admin_function_invocations_total',
  help: 'Total admin-function invocations on the voucher contract',
  labelNames: ['function'],
  registers: [metricsRegistry],
});
