import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { localRequestUrl, readJson } from "../scripts/bridge-http.mjs";

test("JSON request decoding preserves Chinese text and emoji split across chunks", async () => {
  const payload = { name: "创作画布 🎨", prompt: "参考图片，保持人物一致" };
  const bytes = Buffer.from(JSON.stringify(payload));
  const stream = Readable.from([...bytes].map((byte) => Buffer.from([byte])));
  assert.deepEqual(await readJson(stream), payload);
});

test("JSON limits count bytes and malformed bodies return client errors", async () => {
  await assert.rejects(readJson(Readable.from([Buffer.from('"中"')]), 4), { status: 413 });
  await assert.rejects(readJson(Readable.from([Buffer.from('{')])), { status: 400 });
  assert.deepEqual(await readJson(Readable.from([])), {});
});

test("bridge accepts local browsers and CLI clients without Origin", () => {
  for (const host of ["127.0.0.1:4317", "localhost:4317", "localhost"]) {
    for (const origin of [undefined, "http://127.0.0.1:4173", "http://localhost:4173"]) {
      const url = localRequestUrl({ headers: { host, origin }, url: "/projects?view=all" });
      assert.equal(url.pathname, "/projects");
      assert.equal(url.searchParams.get("view"), "all");
    }
  }
});

test("bridge rejects foreign Host even without Origin, and foreign browser origins", () => {
  for (const host of [undefined, "attacker.example:4317", "localhost.attacker.example", "127.0.0.1@attacker.example", "["]) {
    assert.throws(() => localRequestUrl({ headers: { host }, url: "/projects" }), { status: 403 });
  }
  for (const origin of ["https://attacker.example", "null", "http://localhost.attacker.example:4173"]) {
    assert.throws(() => localRequestUrl({ headers: { host: "localhost:4317", origin }, url: "/projects" }), { status: 403 });
  }
});

test("bridge rejects absolute and malformed request targets", () => {
  for (const url of ["http://attacker.example/projects", "//attacker.example/projects"]) {
    assert.throws(() => localRequestUrl({ headers: { host: "localhost:4317" }, url }), { status: 400 });
  }
});
