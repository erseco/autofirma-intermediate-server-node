import { describe, expect, it } from "vitest";
import {
  IntermediateServer,
  MemoryStore,
  ProtocolError,
  StorageError,
  type Store,
} from "../src/index.ts";

const clock = () => 1000;

function server(): IntermediateServer {
  return new IntermediateServer(new MemoryStore(clock), {
    maxPayloadBytes: 16,
    ttlSeconds: 60,
  });
}

const brokenStore: Store = {
  put: () => Promise.reject(new StorageError("disco lleno")),
  consume: () => Promise.reject(new StorageError("disco ilegible")),
  purgeExpired: () => Promise.resolve(0),
};

describe("IntermediateServer", () => {
  it("answers the health check without cache", async () => {
    const response = await server().handle({ op: "check" });
    expect(response).toMatchObject({ status: 200, body: "OK" });
    expect(response.headers["Cache-Control"]).toBe("no-store");
  });

  it("stores a payload and delivers it only once", async () => {
    const instance = server();
    const put = await instance.handle({
      op: "put",
      v: "1_0",
      id: "Abc123_-",
      dat: "ciphertext",
    });
    const get = await instance.handle({
      op: "get",
      v: "1_0",
      id: "Abc123_-",
      it: "0",
    });
    const again = await instance.handle({
      op: "get",
      v: "1_0",
      id: "Abc123_-",
    });
    expect(put.body).toBe("OK");
    expect(get.body).toBe("ciphertext");
    expect(again.body).toBe(ProtocolError.invalidIdentifier);
  });

  it.each([
    ["missing operation", {}, "ERR-00:="],
    ["unsupported operation", { op: "delete", v: "1_0" }, "ERR-01:="],
    ["missing version", { op: "put" }, "ERR-20:="],
    ["unsupported version", { op: "put", v: "2_0" }, "ERR-01:="],
    ["missing identifier", { op: "put", v: "1_0" }, "ERR-05:="],
    [
      "invalid identifier",
      { op: "put", v: "1_0", id: "../escape", dat: "data" },
      "ERR-06:=",
    ],
    ["array identifier", { op: "get", v: "1_0", id: ["x"] }, "ERR-05:="],
  ])("returns a protocol error for %s", async (_name, parameters, prefix) => {
    const response = await server().handle(parameters);
    expect(response.status).toBe(200);
    expect(response.body.startsWith(prefix)).toBe(true);
  });

  it("stores missing data as a protocol error", async () => {
    const instance = server();
    await instance.handle({ op: "put", v: "1_0", id: "identifier" });
    expect(
      (await instance.handle({ op: "get", v: "1_0", id: "identifier" })).body,
    ).toBe(ProtocolError.missingData);
  });

  it("stores oversized data as a protocol error, counting bytes", async () => {
    const instance = server();
    await instance.handle({
      op: "put",
      v: "1_0",
      id: "identifier",
      dat: "ñ".repeat(9),
    });
    expect(
      (await instance.handle({ op: "get", v: "1_0", id: "identifier" })).body,
    ).toBe(ProtocolError.invalidData);
  });

  it("turns storage failures into protocol errors", async () => {
    const instance = new IntermediateServer(brokenStore);
    expect(
      (await instance.handle({ op: "put", v: "1_0", id: "doc", dat: "x" }))
        .body,
    ).toBe(ProtocolError.storageFailure);
    expect(
      (await instance.handle({ op: "get", v: "1_0", id: "doc" })).body,
    ).toBe(ProtocolError.invalidData);
  });

  it("does not hide unexpected errors", async () => {
    const instance = new IntermediateServer({
      ...brokenStore,
      put: () => Promise.reject(new Error("bug")),
    });
    await expect(
      instance.handle({ op: "put", v: "1_0", id: "doc", dat: "x" }),
    ).rejects.toThrow("bug");
    const reading = new IntermediateServer({
      ...brokenStore,
      consume: () => Promise.reject(new Error("bug")),
    });
    await expect(
      reading.handle({ op: "get", v: "1_0", id: "doc" }),
    ).rejects.toThrow("bug");
  });

  it("rejects non-positive limits", () => {
    expect(
      () => new IntermediateServer(brokenStore, { maxPayloadBytes: 0 }),
    ).toThrow(RangeError);
    expect(
      () => new IntermediateServer(brokenStore, { ttlSeconds: 0 }),
    ).toThrow(RangeError);
  });

  describe("fetch", () => {
    it("merges query and form, with the form taking precedence", async () => {
      const instance = server();
      const put = await instance.fetch(
        new Request("https://example.org/storage?op=put&id=query", {
          method: "POST",
          body: new URLSearchParams({ v: "1_0", id: "form", dat: "a+b/c=" }),
        }),
      );
      expect(await put.text()).toBe("OK");
      expect(put.headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
      const get = await instance.fetch(
        new Request("https://example.org/retrieve?op=get&v=1_0&id=form"),
      );
      expect(await get.text()).toBe("a+b/c=");
    });

    it("stops reading a body over the request limit", async () => {
      const instance = server();
      const response = await instance.fetch(
        new Request("https://example.org/storage", {
          method: "POST",
          body: "x".repeat(instance.maxRequestBytes + 1),
        }),
      );
      expect(await response.text()).toBe(ProtocolError.invalidData);
    });

    it("accepts a POST without body", async () => {
      const response = await server().fetch(
        new Request("https://example.org/?op=check", { method: "POST" }),
      );
      expect(await response.text()).toBe("OK");
    });
  });
});

describe("MemoryStore", () => {
  it("expires and purges entries", async () => {
    let now = 1000;
    const store = new MemoryStore(() => now);
    await store.put("a", "1", 10);
    await store.put("b", "2", 100);
    now = 1010;
    expect(await store.consume("a")).toBeNull();
    await store.put("c", "3", 5);
    now = 1020;
    expect(await store.purgeExpired()).toBe(1);
    expect(await store.consume("b")).toBe("2");
    expect(await store.consume("missing")).toBeNull();
  });

  it("rejects a non-positive TTL", async () => {
    await expect(new MemoryStore().put("a", "1", 0)).rejects.toThrow(
      RangeError,
    );
  });
});
