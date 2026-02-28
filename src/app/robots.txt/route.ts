export function GET() {
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /inbox",
    "Disallow: /nodeinfo/",
    "Disallow: /.well-known/",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain" },
  });
}
