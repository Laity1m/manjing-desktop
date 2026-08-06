declare module "cloudflare:workers" {
  interface Env {
    DB?: unknown;
    [key: string]: unknown;
  }

  const env: Env;
  export { env };
}
