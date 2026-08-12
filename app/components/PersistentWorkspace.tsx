"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import StudioClient from "../studio-client";

export default function PersistentWorkspace({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const studioActive = pathname === "/studio";
  const [studioMounted, setStudioMounted] = useState(studioActive);
  const [studioInstance, setStudioInstance] = useState(0);
  const firstMountPending = useRef(false);

  useEffect(() => {
    if (!studioActive || studioMounted) return;
    firstMountPending.current = true;
    queueMicrotask(() => setStudioMounted(true));
  }, [studioActive, studioMounted]);

  useEffect(() => {
    if (!studioActive || !studioMounted) return;
    if (firstMountPending.current) {
      firstMountPending.current = false;
      return;
    }
    const pendingHandoff = Boolean(
      window.localStorage.getItem("manjing-new-studio")
      || window.localStorage.getItem("manjing-studio-open-project")
      || window.localStorage.getItem("manjing-studio-library-import")
    );
    if (!pendingHandoff) return;
    let producing = false;
    try { producing = JSON.parse(window.localStorage.getItem("manjing-production-runtime-v1") || "null")?.active === true; } catch { producing = false; }
    if (!producing) queueMicrotask(() => setStudioInstance((value) => value + 1));
  }, [studioActive, studioMounted]);

  return <>
    {studioMounted && <div
      data-persistent-workspace="studio"
      aria-hidden={!studioActive}
      style={{ display: studioActive ? "block" : "none" }}
    >
      <StudioClient key={studioInstance} surface="studio" />
    </div>}
    {!studioActive && children}
  </>;
}
