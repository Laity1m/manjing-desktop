import type { Metadata } from "next";
import "./globals.css";
import NavigationBridge from "./components/NavigationBridge";

export const metadata: Metadata = {
  metadataBase: new URL("http://manjing.localhost"),
  title: "漫镜 · AI 漫剧创作与剪辑工作台",
  description: "从剧本、分镜、角色一致性、动态视频和配音，到浏览器多轨剪辑与成片导出的一站式 AI 漫剧工作台。",
  openGraph: {
    title: "漫镜 · 从故事到成片的 AI 漫剧工作台",
    description: "多 AI 分工生成，专业时间线继续精剪；每个阶段产物均可查看、下载和替换。",
    images: [{ url: "/og-v4.png", width: 1736, height: 905 }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "漫镜 · 从故事到成片的 AI 漫剧工作台",
    description: "多 AI 分工生成，专业时间线继续精剪；每个阶段产物均可查看、下载和替换。",
    images: ["/og-v4.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><NavigationBridge />{children}</body></html>;
}
