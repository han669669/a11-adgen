/** A loopback host is local development (`wrangler dev`), where plain HTTP never leaves the computer. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const HSTS = "max-age=31536000; includeSubDomains";

/**
 * The public address is HTTPS only. A bearer token or a client link sent over plain HTTP is in clear text on the network,
 * so the app must not answer it: GET and HEAD go to the HTTPS address, and every other method is refused before anything reads it.
 * Each HTTPS answer tells the client to use HTTPS for the next year (RFC 6797; the header has no meaning on plain HTTP).
 */
export async function httpsOnly(request: Request, serve: () => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  if (LOOPBACK.has(url.hostname)) return serve();
  if (url.protocol === "https:") {
    const answer = await serve();
    const secured = new Response(answer.body, answer);
    secured.headers.set("strict-transport-security", HSTS);
    return secured;
  }
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("HTTPS required.", { status: 403 });
  url.protocol = "https:";
  return Response.redirect(url.href, 301);
}
