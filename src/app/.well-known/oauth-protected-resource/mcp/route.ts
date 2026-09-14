import { GET as rootMetadata } from "../route";

export const dynamic = "force-dynamic";
export async function GET() { return rootMetadata(); }
