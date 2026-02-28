import { redirect, notFound } from "next/navigation";
import { getGlobals } from "@/lib/globals";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  const { config } = getGlobals();
  if (!(username in config.bots)) {
    notFound();
  }
  redirect(`/@${username}`);
}
