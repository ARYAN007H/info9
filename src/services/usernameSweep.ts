import type { WnnSite, WnnVerdict } from '../utils/wnn';

/**
 * Client-side orchestrator for the WhatsMyName username sweep. Runs probes
 * through the local server checker with bounded concurrency and streaming
 * progress, so ~700 sites complete in well under a minute.
 */

export interface SweepSiteResult {
  site: WnnSite;
  verdict: WnnVerdict;
  httpStatus: number;
  elapsedMs: number;
  error?: string;
}

export interface SweepProgress {
  completed: number;
  total: number;
  results: SweepSiteResult[];
}

export async function sweepUsername(
  username: string,
  sites: WnnSite[],
  onProgress: (progress: SweepProgress) => void,
  concurrency = 24,
  signal?: AbortSignal
): Promise<SweepSiteResult[]> {
  const results: SweepSiteResult[] = [];
  let completed = 0;
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (signal?.aborted) return;
      const index = nextIndex++;
      if (index >= sites.length) return;
      const site = sites[index];
      const result = await checkSite(username, site);
      results.push(result);
      completed++;
      onProgress({ completed, total: sites.length, results });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, sites.length) }, () => worker())
  );
  return results;
}

export async function checkSite(
  username: string,
  site: WnnSite
): Promise<SweepSiteResult> {
  const started = performance.now();
  try {
    const res = await fetch('/api/osint/wnn/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        uriCheck: site.uriCheck,
        eCode: site.eCode,
        eString: site.eString,
        mCode: site.mCode,
        mString: site.mString,
      }),
    });
    const json = (await res.json()) as {
      verdict?: WnnVerdict;
      httpStatus?: number;
      elapsedMs?: number;
      error?: string;
    };
    return {
      site,
      verdict: json.verdict ?? 'UNKNOWN',
      httpStatus: json.httpStatus ?? 0,
      elapsedMs: json.elapsedMs ?? Math.round(performance.now() - started),
      error: json.error,
    };
  } catch (err) {
    return {
      site,
      verdict: 'UNKNOWN',
      httpStatus: 0,
      elapsedMs: Math.round(performance.now() - started),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
