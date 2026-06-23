import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSharedClient } from "@supabase/supabase-js";

// Suite-wide activity log — CoreDocs edition. CoreDocs runs on its OWN Supabase project,
// but the suite-wide log lives in the SHARED project (read by CoreReports). So we resolve
// the user from CoreDocs' own session, then write the row to the shared project using its
// service-role key. No-ops until COREFLOW_SUPABASE_SERVICE_ROLE_KEY is configured.
//
// NOTE: CoreDocs auth user ids belong to a different auth project, so we never write
// user_id into the shared table — "who" is carried by email.

const MODULE = "docs";
const SHARED_URL = process.env.COREFLOW_SUPABASE_URL;
const SHARED_SERVICE = process.env.COREFLOW_SUPABASE_SERVICE_ROLE_KEY;

export type ActivityInput = {
  area: string;
  action: string;
  targetType?: string;
  targetId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  email?: string | null;
};

export async function logActivity(input: ActivityInput): Promise<void> {
  let email: string | null = input.email ?? null;
  if (!email) {
    try {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      email = user?.email ?? null;
    } catch { /* no session */ }
  }

  after(async () => {
    try {
      if (!SHARED_URL || !SHARED_SERVICE) return; // not configured yet — silent no-op
      const sb = createSharedClient(SHARED_URL, SHARED_SERVICE, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await sb.from("coreflow_audit_log").insert({
        company_id: null,
        module: MODULE,
        area: input.area,
        action: input.action,
        target_type: input.targetType ?? null,
        target_id: input.targetId ?? null,
        summary: input.summary ?? null,
        metadata: input.metadata ?? null,
        user_id: null, // CoreDocs ids are a different auth project — identify by email
        email,
      });
    } catch { /* never break the request over logging */ }
  });
}
