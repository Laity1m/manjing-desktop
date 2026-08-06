import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("http://manjing.localhost"),
  title: "漫镜 —— AI 漫剧与视频工作台",
  description: "从剧本、分镜到资产生成、配音和视频剪辑的一体化 AI 漫剧/视频工作流桌面应用。",
  openGraph: {
    title: "漫镜 AI 漫剧与视频工作台",
    description: "在一款本地桌面应用中完成 AI 漫剧流程、视频生成、剪辑和导出。",
    images: [{ url: "/og-v4.png", width: 1736, height: 905 }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "漫镜 AI 漫剧与视频工作台",
    description: "本地 AI 漫剧与 AI 视频一体化工作流程应用。",
    images: ["/og-v4.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
