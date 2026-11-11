import { json, parseSearchParams } from "@/lib/http";
import { searchScholarships } from "@/lib/services/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return json(await searchScholarships(parseSearchParams(new URL(req.url).searchParams)));
}
