import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  IntermediateServer,
  MemoryStore,
  ProtocolError,
} from "../src/index.ts";
import { toNodeHandler, type NodeRequest } from "../src/node.ts";

let http: Server | undefined;

afterEach(() => http?.close());

async function listen(
  instance: IntermediateServer,
  prepare: (request: NodeRequest) => void = () => undefined,
): Promise<string> {
  const handler = toNodeHandler(instance);
  http = createServer((request, response) => {
    prepare(request);
    void handler(request, response);
  });
  await new Promise<void>((resolve) => http?.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
}

describe("toNodeHandler", () => {
  it("serves storage and retrieve over node:http", async () => {
    const base = await listen(new IntermediateServer(new MemoryStore()));
    const put = await fetch(`${base}/storage?op=put`, {
      method: "POST",
      body: new URLSearchParams({ v: "1_0", id: "abc", dat: "payload" }),
    });
    expect(await put.text()).toBe("OK");
    expect(put.headers.get("cache-control")).toBe("no-store");
    const get = await fetch(`${base}/retrieve?op=get&v=1_0&id=abc`);
    expect(await get.text()).toBe("payload");
  });

  it("uses a body already parsed by Express", async () => {
    const base = await listen(
      new IntermediateServer(new MemoryStore()),
      (request) => {
        request.body = { op: "check", ignored: 1 };
      },
    );
    expect(await (await fetch(`${base}/`, { method: "POST" })).text()).toBe(
      "OK",
    );
  });

  it("rejects a body over the request limit", async () => {
    const instance = new IntermediateServer(new MemoryStore(), {
      maxPayloadBytes: 1,
    });
    const chunks: string[] = [];
    const response = {
      writeHead: () => response,
      end: (body: string) => chunks.push(body),
    };
    const request = Object.assign(
      Readable.from([Buffer.alloc(instance.maxRequestBytes + 1)]),
      {
        method: "POST",
        url: "/storage",
      },
    ) as unknown as NodeRequest;
    await toNodeHandler(instance)(request, response as never);
    expect(chunks).toEqual([ProtocolError.invalidData]);
  });

  it("tolerates a request without URL", async () => {
    const chunks: string[] = [];
    const response = {
      writeHead: () => response,
      end: (body: string) => chunks.push(body),
    };
    const request = Object.assign(Readable.from([]), {
      method: "GET",
    }) as unknown as NodeRequest;
    await toNodeHandler(new IntermediateServer(new MemoryStore()))(
      request,
      response as never,
    );
    expect(chunks).toEqual([ProtocolError.missingOperation]);
  });
});
