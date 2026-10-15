# Instrucciones para agentes

## Alcance

Implementación TypeScript del servidor intermedio de AutoScript (`storage` y
`retrieve`, protocolo `v=1_0`). Es la gemela de
[`autofirma-intermediate-server`](https://github.com/erseco/autofirma-intermediate-server)
(PHP): cualquier cambio de protocolo, código de error o formato en disco debe
hacerse en las dos, y `FilesystemStore` tiene que seguir leyendo y escribiendo
los mismos ficheros que su equivalente PHP.

No depende de `@erseco/autofirma-client`: solo comparten el protocolo. No
añadas cifrado, firma, sesiones, UI ni lógica de un framework concreto.

## Idioma y estilo

- Código, identificadores y APIs públicas en inglés.
- Comentarios, documentación y textos para personas en español.
- Dos espacios en TypeScript, JSON y YAML. TypeScript estricto, sin `any`.

## Arquitectura

- `src/server.ts`: núcleo sobre la Fetch API y parámetros ya leídos.
- `src/protocol.ts`: códigos `ERR-…`, con los textos idénticos al de PHP.
- `src/store.ts`: contrato `Store` y `MemoryStore`, sin dependencias de Node.
- `src/fs.ts` (`/fs`) y `src/node.ts` (`/node`): lo único que importa `node:*`.
  El punto de entrada principal tiene que seguir funcionando en Workers y Deno.

## Pruebas

```bash
make install
make check
```

Los fallos de almacenamiento salen como `ERR-…`, nunca como excepción ni como
error HTTP. Prueba límites de tamaño, identificadores inválidos y consumo único.

## Versiones y publicación

Mayor y menor acompañan a la línea de AutoFirma de `@erseco/autofirma-client`,
y los números coinciden con los del servidor PHP para el mismo comportamiento;
el parche es propio y solo crece. `publish.yml` publica un tag `v*` bajo
`latest` y cada push a `main` bajo `canary`.

Cada tag lleva **siempre** su GitHub Release con el tarball publicado. Si el
workflow falla antes de crearla, créala a mano con `gh release create`. Npm no admite reutilizar un número aunque se despublique. No añadas
tokens npm al repositorio.
