"use client";

import Link from "next/link";

const NAV_ITEMS = [
  { href: "/", label: "首页", id: "home" },
  { href: "/chat", label: "聊天区", id: "chat" },
  { href: "/studio", label: "AI 工作台", id: "studio" },
  { href: "/skills", label: "技能与记忆", id: "skills" },
  { href: "/learning", label: "学习中心", id: "learning" },
  { href: "/video", label: "AI 视频", id: "video" },
  { href: "/canvas", label: "画布", id: "canvas" },
  { href: "/editor", label: "编辑器", id: "editor" },
  { href: "/assets", label: "资产库", id: "assets" },
  { href: "/models", label: "模型中心", id: "models" },
  { href: "/projects", label: "项目", id: "projects" },
];

export default function SiteNav({ current }: { current: string }) {
  function preserveActiveProduction(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (typeof window === "undefined") return;
    const isCompanion = new URLSearchParams(window.location.search).get("companion") === "1";
    if (isCompanion && href === "/studio") {
      event.preventDefault();
      window.close();
      return;
    }
    // Route changes now stay in the main window. Heavy pages load on demand and
    // production state is restored from the local runtime snapshot.
  }

  return <nav className="global-nav">
    <Link prefetch={false} className="global-brand" href="/" onClick={(event) => preserveActiveProduction(event, "/")}>
      <span>漫</span><div><b>漫镜</b><small>AI 漫剧工作台</small></div>
    </Link>
    <div className="global-nav-links">{NAV_ITEMS.map((item) => <Link prefetch={false} key={item.id} className={current === item.id ? "active" : ""} href={item.href} onClick={(event) => preserveActiveProduction(event, item.href)}>{item.label}</Link>)}</div>
    <Link prefetch={false} className="global-start" href={current === "chat" ? "/chat#agent-chat-input" : "/studio"} onClick={(event) => preserveActiveProduction(event, current === "chat" ? "/chat#agent-chat-input" : "/studio")}>{current === "chat" ? "继续聊天" : "进入工作区"}</Link>
  </nav>;
}
