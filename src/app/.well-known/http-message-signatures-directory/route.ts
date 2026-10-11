import { getWebBotAuthDirectory } from "@/lib/web-bot-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return getWebBotAuthDirectory(request);
}
