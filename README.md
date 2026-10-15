# AutoFirma Intermediate Server para Node

[![CI](https://github.com/erseco/autofirma-intermediate-server-node/actions/workflows/ci.yml/badge.svg)](https://github.com/erseco/autofirma-intermediate-server-node/actions/workflows/ci.yml)
[![Codecov](https://codecov.io/gh/erseco/autofirma-intermediate-server-node/graph/badge.svg)](https://codecov.io/gh/erseco/autofirma-intermediate-server-node)
[![npm](https://img.shields.io/npm/v/@erseco/autofirma-intermediate-server.svg)](https://www.npmjs.com/package/@erseco/autofirma-intermediate-server)
[![License](https://img.shields.io/github/license/erseco/autofirma-intermediate-server-node)](LICENSE)

Implementación TypeScript, independiente de frameworks, del servidor intermedio
que AutoScript utiliza para intercambiar datos entre una aplicación web y
AutoFirma. Es la versión para Node, Bun, Deno y Cloudflare Workers de
[`autofirma-intermediate-server`](https://github.com/erseco/autofirma-intermediate-server)
(PHP), con el mismo protocolo, los mismos códigos de error y el mismo formato
en disco.

> [!IMPORTANT]
> Este proyecto no pertenece al Gobierno de España, no incluye AutoFirma y no
> realiza ni valida firmas electrónicas. Solo transporta temporalmente datos
> opacos que AutoScript y AutoFirma cifran y descifran.

## Para qué sirve

Cuando la comunicación local por WebSocket no está disponible (en móviles, por
ejemplo), AutoScript necesita dos servicios HTTP:

- **storage**: recibe temporalmente la petición o el resultado cifrado;
- **retrieve**: entrega el dato una sola vez y lo elimina.

Ambos deben compartir almacenamiento. Las dos rutas pueden delegar en la misma
instancia de `IntermediateServer`.

## Instalación

```bash
npm install @erseco/autofirma-intermediate-server
```

## Uso

### Fetch API: Hono, Bun, Deno, Workers

```ts
import {
  IntermediateServer,
  MemoryStore,
} from "@erseco/autofirma-intermediate-server";

const server = new IntermediateServer(new MemoryStore());

// Hono
app.all("/autofirma/:route{storage|retrieve}", (c) => server.fetch(c.req.raw));

// Bun
Bun.serve({ fetch: (request) => server.fetch(request) });
```

### Express o `node:http`

```ts
import express from "express";
import { IntermediateServer } from "@erseco/autofirma-intermediate-server";
import { FilesystemStore } from "@erseco/autofirma-intermediate-server/fs";
import { toNodeHandler } from "@erseco/autofirma-intermediate-server/node";

const store = await FilesystemStore.open("/var/lib/autofirma-intermediate");
const handler = toNodeHandler(new IntermediateServer(store));

const app = express();
app.all(["/autofirma/storage", "/autofirma/retrieve"], handler);
```

`toNodeHandler` usa `req.body` si un middleware como `express.urlencoded()` ya
leyó el formulario, y lee el flujo en caso contrario.

### En el navegador

Las dos URL públicas se pasan a
[`@erseco/autofirma-client`](https://github.com/erseco/autofirma-client):

```js
const client = new AutoFirmaClient({
  storageUrl: "https://example.org/autofirma/storage",
  retrieveUrl: "https://example.org/autofirma/retrieve",
});
```

Este paquete no depende del cliente: solo comparten el protocolo.

## Opciones

| Opción            | Por defecto | Descripción                       |
| ----------------- | ----------- | --------------------------------- |
| `maxPayloadBytes` | 20 MiB      | Tamaño máximo de `dat`, en bytes. |
| `ttlSeconds`      | 120         | Vida de cada mensaje.             |

El cuerpo HTTP se deja de leer al superar `maxRequestBytes` (el triple de
`maxPayloadBytes` más 64 KiB, por la codificación del formulario) y se responde
`ERR-07`.

## Almacenamientos

- `MemoryStore`: pruebas y un único proceso persistente. No sirve con varias
  instancias ni en serverless.
- `FilesystemStore` (`/fs`, solo Node): un nodo o un volumen compartido.
  Escribe el mismo formato que el servidor PHP, así que ambos pueden compartir
  directorio.

Para Redis, una base de datos u otro sistema distribuido, implementa `Store`.
`consume()` debe ser atómico: ningún mensaje puede entregarse dos veces. Lanza
`StorageError` para que el fallo llegue a AutoScript como código del protocolo.

`purgeExpired()` no se ejecuta solo: prográmalo periódicamente.

## Seguridad

Las rutas las usan tanto el navegador como AutoFirma, que no envía la cookie de
sesión: no protejas estas rutas con un middleware de sesión. No publiques una URL
fija y anónima sin otra capa de protección. Como mínimo:

- usa exclusivamente HTTPS;
- incluye un token opaco y efímero en la ruta;
- limita tamaño, tasa de peticiones y tiempo de vida;
- almacena fuera de cualquier directorio público;
- evita registrar cuerpos o identificadores;
- usa un almacenamiento compartido si hay varios nodos.

## Desarrollo

```bash
make install
make check
```

## Licencia

GPL-2.0-or-later. AutoFirma y AutoScript mantienen sus propias licencias y
marcas.
