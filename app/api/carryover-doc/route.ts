import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, createClient } from "@/lib/supabase/server";
import { resolveOpenUrl } from "@/lib/services/sp-resolve";
import { resolveDriveItemByUrl, getDriveItemContentBytes } from "@/lib/services/graph";
import { contentDisposition } from "@/lib/http/content-disposition"

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Streams a carry-over document so a controller can look at it before deciding what its
// number and area should be. That is the whole point of the register — a decision made
// from a filename is the guess this exercise exists to replace.
//
// SESSION-GATED, deliberately. Unlike the K138 tender report there is no share link here:
// these are unregistered internal documents mid-triage, not a client deliverable.
//
// SCOPED to the register. The path is taken from the row in cddl_carryover, never from the
// query string — `?ref=CO-042` is looked up, so the route cannot be pointed at an arbitrary
// file in the OneDrive by editing a URL.

// The register has TWO kinds of row and their files live in different places:
//   · tender folder    → a path inside Morné's OneDrive transfer folder
//   · k038 highlighted → a SharePoint file, reached through mddr_entries.file_link
// A controller should not have to know which — the CO reference opens either.
const OWNER = "mornec@ppetech.co.za";
const FOLDER = "Company Docs/Jarrod add to CDDL K124";
const OFFICE = new Set(["docx", "doc", "xlsx", "xls", "pptx", "ppt"]);
const INLINE: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", txt: "text/plain",
};

async function graphToken(): Promise<string> {
  const tenant = process.env.MICROSOFT_TENANT_ID, id = process.env.MICROSOFT_CLIENT_ID, sec = process.env.MICROSOFT_CLIENT_SECRET;
  if (!tenant || !id || !sec) throw new Error("MICROSOFT_TENANT_ID / _CLIENT_ID / _CLIENT_SECRET not set");
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    body: new URLSearchParams({
      client_id: id, client_secret: sec,
      scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials",
    }),
    cache: "no-store",
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Graph token request failed");
  return j.access_token as string;
}

export async function GET(req: NextRequest) {
  // Any signed-in CoreDocs user — the same bar as the CDDL Register itself. These are
  // internal documents mid-triage, so there is no share link and no anonymous access.
  const auth = await createClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const ref = (req.nextUrl.searchParams.get("ref") ?? "").trim();
  const which = req.nextUrl.searchParams.get("file");   // optional: a specific variant
  if (!ref) return NextResponse.json({ error: "Missing ref" }, { status: 400 });

  const db = createServiceClient();
  const { data: row } = await db
    .from("cddl_carryover")
    .select("temp_ref,source_path,source_files,source,file_link,mddr_id")
    .eq("temp_ref", ref)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Not in the carry-over register" }, { status: 404 });

  // ── a SharePoint-hosted K038 document ────────────────────────────────────
  // Resolved through mddr_entries rather than a stored path: the file may be renamed or
  // moved, and CoreDocs' own resolver keeps up with that.
  if (row.file_link) {
    const live = await resolveOpenUrl(String(row.file_link), ref).catch(() => null);
    const item = await resolveDriveItemByUrl(live || String(row.file_link)).catch(() => null);
    if (!item?.driveId) {
      return NextResponse.json({ error: "The file for this document could not be located" }, { status: 404 });
    }
    const ext = (item.name.split(".").pop() || "").toLowerCase();
    const wantPdf = OFFICE.has(ext);
    const bytes = await getDriveItemContentBytes(item.driveId, item.id, wantPdf ? "pdf" : undefined);
    const outName = wantPdf ? item.name.replace(/\.[^.]+$/, ".pdf") : item.name;
    const disp0 = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": wantPdf ? "application/pdf" : (INLINE[ext] ?? item.mimeType ?? "application/octet-stream"),
        "Content-Disposition": contentDisposition(disp0 as "inline" | "attachment", outName),
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // A requested variant must be one of THIS row's files — never an arbitrary path.
  const files = (row.source_files as string[]) ?? [];
  const rel = which && files.includes(which) ? which : (row.source_path as string);

  const ext = (rel.split(".").pop() || "").toLowerCase();
  const enc = `${FOLDER}/${rel}`.split("/").map(encodeURIComponent).join("/");
  const base = `https://graph.microsoft.com/v1.0/users/${OWNER}/drive/root:/${enc}:/content`;
  // Office renders to PDF so it opens in the browser instead of downloading.
  const url = OFFICE.has(ext) ? `${base}?format=pdf` : base;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${await graphToken()}` }, cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Could not open the document (Graph ${res.status})`, file: rel },
      { status: res.status === 404 ? 404 : 502 },
    );
  }

  const buf = await res.arrayBuffer();
  const name = rel.split("/").pop() ?? "document";
  const outName = OFFICE.has(ext) ? name.replace(/\.[^.]+$/, ".pdf") : name;
  const ct = OFFICE.has(ext) ? "application/pdf" : (INLINE[ext] ?? "application/octet-stream");
  const disp = req.nextUrl.searchParams.get("download") === "1" ? "attachment" : "inline";

  return new NextResponse(buf, {
    headers: {
      "Content-Type": ct,
      "Content-Disposition": contentDisposition(disp as "inline" | "attachment", outName),
      "Cache-Control": "private, max-age=300",
    },
  });
}
