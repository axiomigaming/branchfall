/// <reference lib="webworker" />
import { DemoCrashServer, RoundError } from './demoServer';
import type { RequestEnvelope, ServerEnvelope } from './protocol';

const scope = self as unknown as DedicatedWorkerGlobalScope;
// A QA session passes its master seed in the worker's name: "causeway-demo:seed=<value>".
const master = /:seed=(.+)$/.exec(scope.name)?.[1] ?? null;

const now = () => Date.now();
const post = (e: ServerEnvelope) => scope.postMessage(e);

const server = new DemoCrashServer(
  {
    now,
    setTimer: (fn, ms) => setTimeout(fn, Math.max(0, ms)),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
  (push) => post({ push }),
  master,
);

scope.onmessage = (ev: MessageEvent<RequestEnvelope>) => {
  const { id, req } = ev.data;
  try {
    post({ id, ok: true, reply: server.handle(req), now: now() });
  } catch (err) {
    if (err instanceof RoundError) post({ id, ok: false, error: err.code, message: err.message, now: now() });
    else post({ id, ok: false, error: 'UNKNOWN', message: String(err), now: now() });
  }
};
