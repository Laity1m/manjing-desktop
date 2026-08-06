const NAV_ITEMS = [
  { href: "/", label: "首页", id: "home" },
  { href: "/studio", label: "AI 工作台", id: "studio" },
  { href: "/video", label: "自主视频", id: "video" },
  { href: "/canvas", label: "制片画布", id: "canvas" },
  { href: "/editor", label: "剪辑台", id: "editor" },
  { href: "/assets", label: "资产库", id: "assets" },
  { href: "/models", label: "模型与 Key", id: "models" },
  { href: "/projects", label: "项目资产", id: "projects" },
];

export default function SiteNav({ current }: { current: string }) {
  return <nav className="global-nav">
    <a className="global-brand" href="/"><span>漫</span><div><b>漫镜</b><small>AI MOTION STUDIO</small></div></a>
    <div className="global-nav-links">{NAV_ITEMS.map((item) => <a key={item.id} className={current === item.id ? "active" : ""} href={item.href}>{item.label}</a>)}</div>
    <a className="global-start" href={current === "video" ? "/video" : "/studio"}>开始创作 <span>↗</span></a>
  </nav>;
}
