import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { allowed, busy, cleanRequest, cleanResponse, unavailable } from './protocol';

const IDLE_MS = 120_000;
const REQUEST_MS = 4500;

export class OcrContainer extends DurableObject<Env> {
  private active = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (ctx.container?.running) {
      void ctx.blockConcurrencyWhile(() => ctx.container!.setInactivityTimeout(IDLE_MS));
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (!allowed(request)) return new Response(null, { status: 404 });
    if (this.active) return busy();
    this.active = true;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, REQUEST_MS);
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) abort();
    try {
      const input = await cleanRequest(request, controller.signal);
      const container = this.ctx.container;
      if (!container || controller.signal.aborted) return unavailable();
      if (!container.running) {
        container.start({ enableInternet: false });
        // monitor observes async start failures; never logs request/error text.
        this.ctx.waitUntil(container.monitor().catch(() => {
          console.error(JSON.stringify({ event: 'ocr_container_stopped' }));
        }));
      }
      await container.setInactivityTimeout(IDLE_MS);
      // A monitor promise can keep the DO resident. An alarm guarantees that
      // the pilot stops after idle time even while monitoring its lifecycle.
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
      const port = container.getTcpPort(8080);
      // Only retry readiness checks. Never retry an uploaded recognition POST.
      let ready = false;
      while (!controller.signal.aborted) {
        try {
          const health = await port.fetch('http://container/ready', { signal: controller.signal });
          ready = health.ok;
          await health.body?.cancel();
        } catch {}
        if (ready) break;
        await new Promise<void>(resolve => setTimeout(resolve, 100));
      }
      if (!ready || controller.signal.aborted) return unavailable();
      return await cleanResponse(await port.fetch(input), controller.signal);
    } catch {
      return unavailable();
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', abort);
      this.active = false;
    }
  }

  async alarm(): Promise<void> {
    if (this.active) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    } else if (this.ctx.container?.running) {
      await this.ctx.container.destroy();
    }
  }
}

// Caller must bind this exact named entrypoint; ordinary public fetch is never
// a way to start a container, even if a public route is accidentally enabled.
export class OcrService extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    if (!allowed(request)) return new Response(null, { status: 404 });
    const id = this.env.OCR_CONTAINER.idFromName('stateless-image-pilot-v1');
    return this.env.OCR_CONTAINER.get(id).fetch(request);
  }
}

export default { fetch: () => new Response(null, { status: 404 }) } satisfies ExportedHandler<Env>;
