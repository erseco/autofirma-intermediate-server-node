/** Segundos desde la época Unix. Se inyecta para poder probar la caducidad. */
export type Clock = () => number;

export const systemClock: Clock = () => Math.floor(Date.now() / 1000);

/** Error de almacenamiento: el servidor lo traduce a un código del protocolo. */
export class StorageError extends Error {
  override name = "StorageError";
}

/**
 * Almacenamiento temporal de mensajes cifrados.
 *
 * `consume()` debe ser atómico: ningún mensaje puede entregarse dos veces,
 * tampoco con varias peticiones simultáneas o varios nodos.
 */
export interface Store {
  put(identifier: string, payload: string, ttlSeconds: number): Promise<void>;
  consume(identifier: string): Promise<string | null>;
  purgeExpired(): Promise<number>;
}

interface Entry {
  readonly expiresAt: number;
  readonly payload: string;
}

/**
 * Almacenamiento en memoria del proceso.
 *
 * Sirve para pruebas y para un único proceso persistente. No vale con varias
 * instancias ni en entornos serverless, donde cada petición puede caer en un
 * proceso distinto.
 */
export class MemoryStore implements Store {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly clock: Clock = systemClock) {}

  async put(
    identifier: string,
    payload: string,
    ttlSeconds: number,
  ): Promise<void> {
    assertPositiveTtl(ttlSeconds);
    this.entries.set(identifier, {
      expiresAt: this.clock() + ttlSeconds,
      payload,
    });
  }

  async consume(identifier: string): Promise<string | null> {
    const entry = this.entries.get(identifier);
    if (entry === undefined) {
      return null;
    }
    this.entries.delete(identifier);
    return entry.expiresAt <= this.clock() ? null : entry.payload;
  }

  async purgeExpired(): Promise<number> {
    let purged = 0;
    for (const [identifier, entry] of this.entries) {
      if (entry.expiresAt <= this.clock()) {
        this.entries.delete(identifier);
        purged++;
      }
    }
    return purged;
  }
}

export function assertPositiveTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new RangeError("TTL must be a positive integer.");
  }
}
