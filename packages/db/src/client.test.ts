import { it, expect } from "vitest";
import { Database, issueApiKey, hashApiKey } from "./index";
it("sends modern secret keys as apikey and legacy JWT keys as Bearer too", async () => {
  for (const secret of ["sb_secret_fixture", "eyJfixture"]) {
    let headers: Headers | undefined;
    const db = new Database(
      "https://db.fixture",
      secret,
      async (_url, init) => {
        headers = new Headers(init?.headers);
        return Response.json([]);
      },
    );
    await db.call("applications");
    expect(headers!.get("apikey")).toBe(secret);
    expect(headers!.get("Authorization")).toBe(
      secret.startsWith("sb_secret_") ? null : `Bearer ${secret}`,
    );
  }
});
it("issues unique high-entropy keys and persists only hashes/prefixes", () => {
  const a = issueApiKey();
  const b = issueApiKey();
  expect(a.key).not.toBe(b.key);
  expect(a.hash).toBe(hashApiKey(a.key));
  expect(a.hash).toHaveLength(64);
  expect(a.prefix.length).toBeLessThan(a.key.length);
});
