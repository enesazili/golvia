export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Options = { userAgent: string; fetcher?: Fetcher; sleep?: (ms: number) => Promise<void>; now?: () => number; random?: () => number; interval?: number; retries?: number; signal?: AbortSignal };
export function validateUserAgent(value: string) {
  if (!value || /example\.(com|org)|localhost|your[-_ ]|placeholder/i.test(value) || !/(https?:\/\/[^ )]+|[^ ()]+@[^ ()]+\.[a-z]+)/i.test(value)) throw new Error('Set WIKIDATA_USER_AGENT with real project contact information. Example values cannot be used for collection.');
}
class HttpError extends Error { constructor(public status: number, public retryAfter: number) { super(`Wikidata HTTP ${status}`); } }
export class WikidataClient {
  private nextSlot = 0;
  private readonly fetcher: Fetcher;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  constructor(private readonly options: Options) {
    validateUserAgent(options.userAgent);
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? (ms => new Promise((resolve, reject) => {
      if (options.signal?.aborted) { reject(options.signal.reason); return; }
      const abort = () => { clearTimeout(timer); reject(options.signal?.reason); };
      const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve(); }, ms);
      options.signal?.addEventListener('abort', abort, { once: true });
    }));
    this.now = options.now ?? Date.now;
  }
  async json(url: string): Promise<unknown> {
    const retries = this.options.retries ?? 4;
    for (let attempt = 0; ; attempt++) {
      this.options.signal?.throwIfAborted();
      // Reserve the request slot before awaiting: concurrent workers must not
      // observe the same last-request timestamp and burst the endpoint.
      const now = this.now();
      const slot = Math.max(now, this.nextSlot);
      this.nextSlot = slot + (this.options.interval ?? 2500);
      await this.sleep(Math.max(0, slot - now));
      try {
        const timeout = AbortSignal.timeout(45_000);
        const response = await this.fetcher(url, { headers: { 'User-Agent': this.options.userAgent, Accept: 'application/json' }, signal: this.options.signal ? AbortSignal.any([timeout, this.options.signal]) : timeout });
        if (!response.ok) {
          const retry = response.headers.get('retry-after');
          const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - this.now())) : 0;
          if (response.status === 429 && Number.isFinite(delay)) this.nextSlot = Math.max(this.nextSlot, this.now() + delay);
          await response.body?.cancel(); throw new HttpError(response.status, Number.isFinite(delay) ? delay : 0);
        }
        const data = await response.json();
        if (data && typeof data === 'object' && 'error' in data) throw new Error('Wikidata API returned an error');
        return data;
      } catch (error) {
        if (this.options.signal?.aborted) throw error;
        const transient = !(error instanceof HttpError) || error.status === 408 || error.status === 429 || error.status >= 500;
        if (!transient || attempt >= retries) throw error;
        const backoff = Math.min(60_000, 2500 * 2 ** attempt) + Math.floor((this.options.random ?? Math.random)() * 1000);
        await this.sleep(Math.max(backoff, error instanceof HttpError ? error.retryAfter : 0));
      }
    }
  }
}
