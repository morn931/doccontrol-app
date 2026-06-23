"use client";
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// Logs a page view on every client navigation (involvement tracking). Fire-and-forget —
// posts the path to /api/activity/pageview, which records it in the suite-wide log.
// Must be rendered inside a <Suspense> boundary (it reads useSearchParams).
export default function PageViewLogger() {
  const pathname = usePathname();
  const search = useSearchParams();
  const last = useRef<string>("");

  useEffect(() => {
    const qs = search?.toString();
    const path = pathname + (qs ? `?${qs}` : "");
    if (!pathname || path === last.current) return;
    last.current = path;
    try {
      fetch("/api/activity/pageview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore */ }
  }, [pathname, search]);

  return null;
}
