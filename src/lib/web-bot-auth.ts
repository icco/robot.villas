import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, type KeyObject } from "node:crypto";

const DIRECTORY_CONTENT_TYPE = "application/http-message-signatures-directory+json";
let cached: { pem: string; key: KeyObject; jwk: { kty: string; crv: string; x: string }; keyid: string } | undefined;

function getSigningKey() {
  const pem = process.env.WEB_BOT_AUTH_PRIVATE_KEY;
  if (!pem) {
    return undefined;
  }
  if (cached?.pem === pem) {
    return cached;
  }
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("WEB_BOT_AUTH_PRIVATE_KEY must be an Ed25519 private key");
  }
  const exported = createPublicKey(key).export({ format: "jwk" });
  const jwk = { kty: "OKP", crv: "Ed25519", x: exported.x! };
  const thumbprint = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  cached = { pem, key, jwk, keyid: createHash("sha256").update(thumbprint).digest("base64url") };
  return cached;
}

function signHeaders(headers: Headers, components: Array<[string, string]>, tag: string, signing: NonNullable<ReturnType<typeof getSigningKey>>) {
  const created = Math.floor(Date.now() / 1000);
  const params = `(${components.map(([name]) => name).join(" ")});created=${created};expires=${created + 60};keyid="${signing.keyid}";alg="ed25519";nonce="${randomBytes(64).toString("base64url")}";tag="${tag}"`;
  const base = [...components.map(([name, value]) => `${name}: ${value}`), `"@signature-params": ${params}`].join("\n");
  headers.set("Signature-Input", `sig1=${params}`);
  headers.set("Signature", `sig1=:${sign(null, Buffer.from(base), signing.key).toString("base64")}:`);
}

export function getWebBotAuthHeaders(url: URL, original: Headers): Headers {
  const headers = new Headers(original);
  const signing = getSigningKey();
  if (!signing) {
    return headers;
  }
  headers.delete("signature");
  headers.delete("signature-input");
  headers.delete("signature-agent");
  if (url.protocol !== "https:") {
    return headers;
  }
  if (!process.env.DOMAIN) {
    throw new Error("DOMAIN is required for Web Bot Auth");
  }
  const agent = new URL(`https://${process.env.DOMAIN}`);
  if (agent.host !== process.env.DOMAIN || agent.username || agent.password || agent.pathname !== "/" || agent.search || agent.hash) {
    throw new Error("DOMAIN must be a public hostname for Web Bot Auth");
  }
  const signatureAgent = `"${agent.origin}"`;
  headers.set("Signature-Agent", signatureAgent);
  signHeaders(headers, [[ '"@authority"', url.host ], [ '"signature-agent"', signatureAgent ]], "web-bot-auth", signing);
  return headers;
}

export function getWebBotAuthDirectory(request: Request): Response {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const signing = getSigningKey();
  if (!signing) {
    return new Response("Web Bot Auth is not configured", { status: 503, headers });
  }
  const body = JSON.stringify({ keys: [signing.jwk] });
  const authority = request.headers.get("host") ?? new URL(request.url).host;
  const digest = `sha-256=:${createHash("sha256").update(body).digest("base64")}:`;
  headers.set("Content-Type", DIRECTORY_CONTENT_TYPE);
  headers.set("Content-Digest", digest);
  signHeaders(headers, [
    [ '"@authority";req', authority ],
    [ '"content-type"', DIRECTORY_CONTENT_TYPE ],
    [ '"content-digest"', digest ],
  ], "http-message-signatures-directory", signing);
  return new Response(body, { headers });
}
