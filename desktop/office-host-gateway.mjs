import { createServer } from "node:https";
import { request as httpRequest } from "node:http";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardedHeaders(headers, publicOrigin) {
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  const publicUrl = new URL(publicOrigin);
  result.host = publicUrl.host;
  result["x-forwarded-host"] = publicUrl.host;
  result["x-forwarded-proto"] = "https";
  return result;
}

export async function startOfficeHostGateway({
  backendOrigin,
  publicOrigin,
  certificate,
  host = "0.0.0.0",
  port,
  onDiagnostic = async () => undefined,
}) {
  const backend = new URL(backendOrigin);
  const publicUrl = new URL(publicOrigin);
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1") {
    throw new Error("The office host gateway backend must remain on loopback HTTP.");
  }
  if (publicUrl.protocol !== "https:" || Number(publicUrl.port || 443) !== port) {
    throw new Error("The office host public origin and TLS port do not match.");
  }

  const server = createServer(certificate, (incoming, outgoing) => {
    if (!incoming.url?.startsWith("/api/")) {
      outgoing.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } }));
      return;
    }
    const target = new URL(incoming.url, backend);
    const proxy = httpRequest(target, {
      method: incoming.method,
      headers: forwardedHeaders(incoming.headers, publicOrigin),
    }, (response) => {
      const headers = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase()) && value !== undefined) headers[name] = value;
      }
      outgoing.writeHead(response.statusCode || 502, headers);
      response.pipe(outgoing);
    });
    proxy.on("error", (error) => {
      void onDiagnostic("office-gateway-proxy-error", { message: error.message });
      if (!outgoing.headersSent) outgoing.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      outgoing.end(JSON.stringify({ ok: false, error: { code: "BACKEND_UNAVAILABLE", message: "The Nautex backend is unavailable." } }));
    });
    incoming.pipe(proxy);
  });

  server.on("tlsClientError", (error) => void onDiagnostic("office-gateway-tls-error", { message: error.message }));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  await onDiagnostic("office-gateway-ready", { publicOrigin, host, port });

  return {
    publicOrigin,
    async stop() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await onDiagnostic("office-gateway-stopped");
    },
  };
}
