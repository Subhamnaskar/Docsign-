/**
 * Work that continues after the response is sent (sealing after the last
 * signature, notifying the next signer). Serverless hosts freeze a function
 * once it responds unless told to wait; the serverless entry registers the
 * host's waitUntil here. On a normal server the promise just runs.
 */
type Runner = (work: Promise<unknown>) => void;
let runner: Runner | null = null;

export function setBackgroundRunner(r: Runner) {
  runner = r;
}

export function background(work: Promise<unknown>, onError: (err: unknown) => void) {
  const guarded = work.catch(onError);
  runner?.(guarded);
}
