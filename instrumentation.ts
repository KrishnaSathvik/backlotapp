/**
 * Server start-up hook (Next.js). Validates production configuration before the instance serves
 * anything (src/lib/config-check.ts). In production a configuration error stops the process, so
 * Cloud Run's startup check fails and the new revision never takes traffic; the previous one keeps
 * serving. BACKLOT_SKIP_CONFIG_CHECK=true bypasses this for an emergency (logged as CRITICAL).
 */
export async function register() {
  // This exact form lets Next.js drop the import from the Edge build (which has no Node modules).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runConfigCheck } = await import('./instrumentation-node.ts');
    runConfigCheck();
  }
}
