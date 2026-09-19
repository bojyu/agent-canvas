// Optional because the local canvas does not require a Cloudflare D1 binding.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
  }
}
