import { checkProductionConfig } from './src/lib/config-check.ts';
import { opsEvent } from './src/lib/ops-log.ts';

/** Node.js-only part of instrumentation.ts (kept separate so the Edge build never bundles it). */
export function runConfigCheck() {
  const report = checkProductionConfig();
  for (const w of report.warnings) opsEvent('config.warning', { detail: w }, 'WARNING');
  if (!report.errors.length) {
    opsEvent('config.ok', { warnings: report.warnings.length });
    return;
  }
  for (const e of report.errors) opsEvent('config.error', { detail: e }, 'ERROR');
  if (process.env.BACKLOT_SKIP_CONFIG_CHECK === 'true') {
    opsEvent('config.check_bypassed', { errors: report.errors.length }, 'CRITICAL');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    opsEvent('config.refusing_to_start', { errors: report.errors.length }, 'CRITICAL');
    process.exit(1);
  }
}
