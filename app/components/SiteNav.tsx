const NAV_ITEMS = [
  { href: "/", label: "首页", id: "home" },
  { href: "/studio", label: "AI 工作台", id: "studio" },
  { href: "/editor", label: "剪辑台", id: "editor" },
  { href: "/models", label: "模型与 Key", id: "models" },
  { href: "/projects", label: "项目资产", id: "projects" },
];

export default function SiteNav({ current }: { current: string }) {
  return <nav className="global-nav">
    <Link className="global-brand" href="/"><span>漫</span><div><b>漫镜</b><small>AI MOTION STUDIO</small></div></Link>
    <div className="global-nav-links">{NAV_ITEMS.map((item) => <Link key={item.id} className={current === item.id ? "active" : ""} href={item.href}>{item.label}</Link>)}</div>
    <Link className="global-start" href="/studio">开始创作 <span>↗</span></Link>
  </nav>;
}
import Link from "next/link";
