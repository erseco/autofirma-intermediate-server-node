import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { join } from "node:path";
import {
  assertPositiveTtl,
  StorageError,
  systemClock,
  type Clock,
  type Store,
} from "./store.ts";

const EXPIRY_LENGTH = 20;

/**
 * Almacenamiento en disco para un único nodo o un volumen compartido.
 *
 * Usa el mismo formato que `FilesystemStore` del servidor PHP: un fichero
 * `sha256(id).message` con la caducidad en 20 dígitos, un salto de línea y el
 * mensaje. Los dos servidores pueden compartir directorio.
 */
export class FilesystemStore implements Store {
  private constructor(
    private readonly directory: string,
    private readonly clock: Clock,
  ) {}

  /** Crea el directorio con permisos 0700 si no existe. No admite enlaces. */
  static async open(
    directory: string,
    clock: Clock = systemClock,
  ): Promise<FilesystemStore> {
    const existing = await lstat(directory).catch(() => null);
    if (existing?.isSymbolicLink()) {
      throw new StorageError(
        "The storage directory cannot be a symbolic link.",
      );
    }
    if (existing === null) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }
    return new FilesystemStore(await realpath(directory), clock);
  }

  async put(
    identifier: string,
    payload: string,
    ttlSeconds: number,
  ): Promise<void> {
    assertPositiveTtl(ttlSeconds);
    const expiry = String(this.clock() + ttlSeconds).padStart(
      EXPIRY_LENGTH,
      "0",
    );
    const temporary = join(
      this.directory,
      `.write-${randomBytes(8).toString("hex")}`,
    );
    try {
      // `wx` falla si el fichero existe: nadie puede colar un enlace previo.
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(`${expiry}\n${payload}`);
      } finally {
        await handle.close();
      }
      // El rename es atómico: un lector ve el mensaje entero o no lo ve.
      await rename(temporary, this.path(identifier));
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw new StorageError("Unable to store the message.", { cause: error });
    }
  }

  async consume(identifier: string): Promise<string | null> {
    const path = this.path(identifier);
    const claimed = `${path}.consume-${randomBytes(8).toString("hex")}`;
    // Solo una petición gana el rename: así nadie recibe el mensaje dos veces.
    try {
      await rename(path, claimed);
    } catch {
      return null;
    }
    try {
      if ((await lstat(claimed)).isSymbolicLink()) {
        return null;
      }
      return this.payload(await readFile(claimed, "utf8"));
    } catch (error) {
      throw new StorageError("Unable to read the claimed message.", {
        cause: error,
      });
    } finally {
      await unlink(claimed).catch(() => undefined);
    }
  }

  async purgeExpired(): Promise<number> {
    let purged = 0;
    for (const name of await readdir(this.directory)) {
      if (!name.includes(".message")) {
        continue;
      }
      const path = join(this.directory, name);
      const stats = await lstat(path);
      if (
        stats.isFile() &&
        this.payload(await readFile(path, "utf8")) !== null
      ) {
        continue;
      }
      if (stats.isFile() || stats.isSymbolicLink()) {
        await unlink(path);
        purged++;
      }
    }
    return purged;
  }

  private path(identifier: string): string {
    return join(
      this.directory,
      `${createHash("sha256").update(identifier).digest("hex")}.message`,
    );
  }

  /** Devuelve el mensaje, o `null` si el registro caducó o está mal formado. */
  private payload(record: string): string | null {
    const expiry = record.slice(0, EXPIRY_LENGTH);
    if (record[EXPIRY_LENGTH] !== "\n" || !/^\d+$/.test(expiry)) {
      return null;
    }
    return Number(expiry) <= this.clock()
      ? null
      : record.slice(EXPIRY_LENGTH + 1);
  }
}
