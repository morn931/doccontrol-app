import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logActivity } from "@/lib/activity";

// Records an authenticated CoreDocs page view in the suite-wide activity log (shared
// project). Fire-and-forget; anonymous (signed-out) views are skipped.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: true });
    const { path } = (await req.json()) as { path?: string };
    if (typeof path === "string" && path) {
      const clean = path.split("?")[0];
      const segs = clean.split("/").filter(Boolean);
      const area = segs[0] ?? "home";
      await logActivity({ area, action: "page.view", summary: path, email: user.email ?? null });
    }
  } catch { /* ignore */ }
  return NextResponse.json({ ok: true });
}
