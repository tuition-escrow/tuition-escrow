/**
 * Prometheus metrics for the attester service.
 * README section: "Operations and monitoring"
 */

import { Registry, Counter } from 'prom-client';

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: 'attester' });

export const attestationsCounter = new Counter({
  name: 'attester_attestations_total',
  help: 'Total attestation attempts, labelled by result',
  labelNames: ['result'], // 'approved' | 'rejected' | 'skipped' | 'error'
  registers: [metricsRegistry],
});
