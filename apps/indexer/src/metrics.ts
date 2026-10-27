/**
 * Prometheus metrics for the indexer.
 * README section: "Operations and monitoring"
 *
 * Exported metrics:
 *   - indexer_latest_ledger_processed  — most recent ledger fully processed
 *   - indexer_lag_ledgers              — lag vs current ledger (filled by caller)
 *   - indexer_events_total             — counter by event_type
 *   - indexer_errors_total             — counter by error_type
 */

import { Registry, Gauge, Counter } from 'prom-client';

export const metricsRegistry = new Registry();
metricsRegistry.setDefaultLabels({ app: 'indexer' });

export const latestLedgerGauge = new Gauge({
  name: 'indexer_latest_ledger_processed',
  help: 'Most recent ledger sequence fully processed by the indexer',
  registers: [metricsRegistry],
});

export const lagGauge = new Gauge({
  name: 'indexer_lag_ledgers',
  help: 'Number of ledgers the indexer is behind the network tip',
  registers: [metricsRegistry],
});

export const eventsCounter = new Counter({
  name: 'indexer_events_total',
  help: 'Total events processed by the indexer, labelled by event_type',
  labelNames: ['event_type'],
  registers: [metricsRegistry],
});

export const errorsCounter = new Counter({
  name: 'indexer_errors_total',
  help: 'Total errors encountered by the indexer, labelled by error_type',
  labelNames: ['error_type'],
  registers: [metricsRegistry],
});
