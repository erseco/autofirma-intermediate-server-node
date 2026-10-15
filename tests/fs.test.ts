import { mkdtemp, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilesystemStore } from "../src/fs.ts";
import { StorageError } from "../src/store.ts";

async function temporary(): Promise<string> {
  return mkdtemp(join(tmpdir(), "afis-"));
}

describe("FilesystemStore", () => {
  it("stores, consumes once and expires", async () => {
    let now = 1000;
    const store = await FilesystemStore.open(
      join(await temporary(), "nested"),
      () => now,
    );
    await store.put("id", "payload\nwith lines", 10);
    expect(await store.consume("id")).toBe("payload\nwith lines");
    expect(await store.consume("id")).toBeNull();
    await store.put("old", "x", 10);
    now = 1010;
    expect(await store.consume("old")).toBeNull();
  });

  it("writes the same record format as the PHP server", async () => {
    const directory = await temporary();
    const store = await FilesystemStore.open(directory, () => 1000);
    await store.put("id", "data", 5);
    const [name] = await readdir(directory);
    expect(name).toBe(
      "a56145270ce6b3bebd1dd012b73948677dd618d496488bc608a3cb43ce3547dd.message",
    );
  });

  it("purges expired, malformed and linked records", async () => {
    let now = 1000;
    const directory = await temporary();
    const store = await FilesystemStore.open(directory, () => now);
    await store.put("live", "x", 100);
    await store.put("dead", "x", 10);
    await writeFile(join(directory, "bad.message"), "garbage");
    await symlink("/etc/hosts", join(directory, "link.message"));
    await writeFile(join(directory, "unrelated.txt"), "keep");
    now = 1050;
    expect(await store.purgeExpired()).toBe(3);
    expect(await store.consume("live")).toBe("x");
  });

  it("refuses a symbolic link as directory", async () => {
    const directory = await temporary();
    const link = join(directory, "link");
    await symlink(directory, link);
    await expect(FilesystemStore.open(link)).rejects.toThrow(StorageError);
  });

  it("reports write failures as storage errors", async () => {
    const directory = await temporary();
    const store = await FilesystemStore.open(directory);
    await expect(store.put("id", "x", 0)).rejects.toThrow(RangeError);
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true });
    await expect(store.put("id", "x", 10)).rejects.toThrow(StorageError);
  });
});
