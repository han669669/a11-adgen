/** Stand-in for the "cloudflare:workers" module in Node tests. */
export class WorkerEntrypoint<Env = unknown> {
  constructor(
    public ctx: unknown,
    public env: Env,
  ) {}
}
