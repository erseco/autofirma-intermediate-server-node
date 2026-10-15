import { ProtocolError } from "./protocol.ts";
import type { Store } from "./store.ts";

export const SYNTAX_VERSION = "1_0";

/** Parámetros ya leídos de la consulta y del formulario. */
export type Parameters = URLSearchParams | Readonly<Record<string, unknown>>;

export interface ProtocolResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface IntermediateServerOptions {
  /** Tamaño máximo de `dat` en bytes. Por defecto, 20 MiB como AutoScript. */
  readonly maxPayloadBytes?: number;
  /** Tiempo de vida de cada mensaje. Por defecto, 120 segundos. */
  readonly ttlSeconds?: number;
}

const HEADERS = {
  "Cache-Control": "no-store",
  "Content-Type": "text/plain; charset=UTF-8",
  "X-Content-Type-Options": "nosniff",
} as const;

const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/;
const encoder = new TextEncoder();

/**
 * Servidor intermedio de AutoScript (`storage` y `retrieve`), independiente de
 * frameworks. Las dos rutas pueden delegar en la misma instancia.
 */
export class IntermediateServer {
  private readonly maxPayloadBytes: number;
  private readonly ttlSeconds: number;
  /**
   * Límite del cuerpo HTTP completo. La codificación de formulario puede
   * triplicar el tamaño del dato (`+` pasa a `%2B`), más margen para el resto
   * de campos. Por encima no se sigue leyendo.
   */
  readonly maxRequestBytes: number;

  constructor(
    private readonly store: Store,
    options: IntermediateServerOptions = {},
  ) {
    this.maxPayloadBytes = options.maxPayloadBytes ?? 20 * 1024 * 1024;
    this.ttlSeconds = options.ttlSeconds ?? 120;
    if (!Number.isInteger(this.maxPayloadBytes) || this.maxPayloadBytes < 1) {
      throw new RangeError("Maximum payload size must be a positive integer.");
    }
    if (!Number.isInteger(this.ttlSeconds) || this.ttlSeconds < 1) {
      throw new RangeError("TTL must be a positive integer.");
    }
    this.maxRequestBytes = this.maxPayloadBytes * 3 + 64 * 1024;
  }

  /**
   * Atiende una petición de la Fetch API: Hono, Bun, Deno, Cloudflare Workers
   * y cualquier runtime con `Request`/`Response` estándar.
   */
  async fetch(request: Request): Promise<Response> {
    const parameters = new URLSearchParams(new URL(request.url).search);
    if (request.method !== "GET" && request.method !== "HEAD") {
      const body = await readLimited(request.body, this.maxRequestBytes);
      if (body === null) {
        return toFetchResponse(respond(ProtocolError.invalidData));
      }
      // Los campos del formulario prevalecen sobre los de la consulta.
      for (const [name, value] of new URLSearchParams(body)) {
        parameters.set(name, value);
      }
    }
    return toFetchResponse(await this.handle(parameters));
  }

  /** Atiende unos parámetros ya leídos. Un fallo del almacenamiento sale como `ERR-…`. */
  async handle(parameters: Parameters): Promise<ProtocolResponse> {
    return respond(await this.body(parameters));
  }

  private async body(parameters: Parameters): Promise<string> {
    const operation = value(parameters, "op")?.toLowerCase();
    if (!operation) {
      return ProtocolError.missingOperation;
    }
    if (operation === "check") {
      return "OK";
    }
    const version = value(parameters, "v");
    if (version === null) {
      return ProtocolError.missingSyntaxVersion;
    }
    if (version !== SYNTAX_VERSION) {
      return ProtocolError.unsupportedOperation;
    }
    if (operation !== "put" && operation !== "get") {
      return ProtocolError.unsupportedOperation;
    }

    const identifier = value(parameters, "id");
    if (!identifier) {
      return ProtocolError.missingIdentifier;
    }
    if (!IDENTIFIER.test(identifier)) {
      return ProtocolError.invalidIdentifier;
    }

    return operation === "put"
      ? this.put(identifier, value(parameters, "dat"))
      : this.get(identifier);
  }

  private async put(identifier: string, data: string | null): Promise<string> {
    // Un dato ausente o excesivo no se rechaza aquí: se guarda el error para
    // que quien recoja el mensaje reciba el motivo, como hace AutoScript.
    let payload = data;
    if (!payload) {
      payload = ProtocolError.missingData;
    } else if (encoder.encode(payload).byteLength > this.maxPayloadBytes) {
      payload = ProtocolError.invalidData;
    }

    try {
      await this.store.put(identifier, payload, this.ttlSeconds);
    } catch (error) {
      if (isStorageError(error)) {
        return ProtocolError.storageFailure;
      }
      throw error;
    }
    return "OK";
  }

  private async get(identifier: string): Promise<string> {
    try {
      return (
        (await this.store.consume(identifier)) ??
        ProtocolError.invalidIdentifier
      );
    } catch (error) {
      if (isStorageError(error)) {
        return ProtocolError.invalidData;
      }
      throw error;
    }
  }
}

/**
 * Por nombre y no con `instanceof`: en CommonJS cada punto de entrada lleva su
 * propia copia de la clase, y el error de `./fs` no sería instancia de la de
 * `.`.
 */
function isStorageError(error: unknown): boolean {
  return error instanceof Error && error.name === "StorageError";
}

export function respond(body: string): ProtocolResponse {
  return { status: 200, headers: { ...HEADERS }, body };
}

function toFetchResponse(response: ProtocolResponse): Response {
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

/** Lee el cuerpo como texto, o devuelve `null` si supera `limit` bytes. */
async function readLimited(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<string | null> {
  if (stream === null) {
    return "";
  }
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

function value(parameters: Parameters, name: string): string | null {
  if (parameters instanceof URLSearchParams) {
    return parameters.get(name);
  }
  if (!Object.hasOwn(parameters, name)) {
    return null;
  }
  const raw = parameters[name];
  return typeof raw === "string" || typeof raw === "number"
    ? String(raw)
    : null;
}
