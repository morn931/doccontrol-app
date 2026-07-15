"use client";

import { useEffect, useState } from "react";
import CoreflowSpinner from "./coreflow-spinner";

// Cross-module navigation overlay. Next's loading.tsx only covers route
// changes INSIDE this app — clicking through to another Coreflow module
// (different origin) is a full browser navigation, which would otherwise sit
// on the old page with no feedback. This listens for clicks on external
// http(s) links and, if the browser hasn't navigated away within 400ms,
// shows the gear until the new document takes over (pagehide) or the user
// comes back via bfcache (pageshow).
export default function CoreflowNavSpinner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const clear = () => { if (t) { clearTimeout(t); t = null; } };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a) return;
      const href = a.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || a.target === "_blank" || a.hasAttribute("download")) return;
      let url: URL;
      try { url = new URL(href, location.href); } catch { return; }
      if (url.origin === location.origin) return; // internal — loading.tsx covers it
      if (url.protocol !== "http:" && url.protocol !== "https:") return;
      clear();
      t = setTimeout(() => setShow(true), 400);
    };
    const onHide = () => { clear(); setShow(false); };
    document.addEventListener("click", onClick, true);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("pageshow", onHide);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("pageshow", onHide);
      clear();
    };
  }, []);
  if (!show) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/80 backdrop-blur-sm">
      <CoreflowSpinner size={192} />
    </div>
  );
}
