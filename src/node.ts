import type { IncomingMessage, ServerResponse } from "node:http";
import { ProtocolError } from "./protocol.ts";
import {
  respond,
  type IntermediateServer,
  type Parameters,
  type ProtocolResponse,
} from "./server.ts";

/** Petición de `node:http`, o de Express si ya ha leído el formulario. */
export type NodeRequest = IncomingMessage & { body?: unknown };

/**
 * Adapta el servidor a `node:http` y a Express.
 *
 * Si un middleware como `express.urlencoded()` ya consumió el cuerpo, se usa
 * `req.body`; si no, se lee el flujo directamente.
 */
export function toNodeHandler(
  server: IntermediateServer,
): (request: NodeRequest, response: ServerResponse) => Promise<void> {
  return async (request, response) => {
    const parameters = new URLSearchParams(
      new URL(request.url ?? "/", "http://localhost").search,
    );
    const form = await readForm(request, server.maxRequestBytes);
    if (form === null) {
      send(response, respond(ProtocolError.invalidData));
      request.destroy();
      return;
    }
    for (const [name, value] of form instanceof URLSearchParams
      ? form
      : Object.entries(form)) {
      if (typeof value === "string") {
        parameters.set(name, value);
      }
    }
    send(response, await server.handle(parameters));
  };
}

function send(response: ServerResponse, result: ProtocolResponse): void {
  response.writeHead(result.status, result.headers);
  response.end(result.body);
}

async function readForm(
  request: NodeRequest,
  limit: number,
): Promise<Parameters | null> {
  if (typeof request.body === "object" && request.body !== null) {
    return request.body as Readonly<Record<string, unknown>>;
  }
  if (request.method === "GET" || request.method === "HEAD") {
    return new URLSearchParams();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).byteLength;
    if (size > limit) {
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}
