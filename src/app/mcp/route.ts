import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getGlobals } from "@/lib/globals";
import { createMcpServer } from "@/lib/mcp";

export const dynamic = "force-dynamic";

/** Stateless, authless MCP endpoint (Streamable HTTP). */
async function handle(request: Request): Promise<Response> {
  const { db, config, domain } = getGlobals();
  const server = createMcpServer({ db, config, domain });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export { handle as GET, handle as POST, handle as DELETE };
