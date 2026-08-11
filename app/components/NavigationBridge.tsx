"use client";

import { useEffect, useState } from "react";

type DesktopNavigation = { navigate?: (pathname: string) => void };

export default function NavigationBridge() {
  const [label, setLabel] = useState("");

  useEffect(() => {
    function navigate(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      let destination: URL;
      try { destination = new URL(anchor.href, window.location.href); } catch { return; }
      if (destination.protocol !== window.location.protocol || destination.host !== window.location.host) return;
      if (destination.pathname === window.location.pathname && destination.search === window.location.search && destination.hash) return;
      const desktop = (window as typeof window & { manjingDesktop?: DesktopNavigation }).manjingDesktop;
      if (!desktop?.navigate) return;
      event.preventDefault();
      event.stopPropagation();
      setLabel((anchor.textContent || "正在切换页面").trim().slice(0, 24));
      desktop.navigate(`${destination.pathname}${destination.search}${destination.hash}`);
      window.setTimeout(() => setLabel(""), 1200);
    }

    window.addEventListener("click", navigate, true);
    return () => window.removeEventListener("click", navigate, true);
  }, []);

  return label ? <div className="desktop-navigation-state" role="status"><i /><span>正在打开：{label}</span></div> : null;
}
