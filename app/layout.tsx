import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://manjing-ai-comic-studio.lingxiangniao03.chatgpt.site"),
  title: "漫镜 · 多 AI 协作生成漫剧",
  description: "导演、编剧、生图、视频、配音与剪辑六个 AI 岗位协作，并支持 LibTV 一键成片与即梦 Seedance 动态视频。",
  openGraph: {
    title: "漫镜 · 多 AI 协作生成漫剧",
    description: "支持 LibTV 一键成片、即梦 Seedance 动态镜头与可编辑多轨工作台。",
    images: [{ url: "/og-v3.png", width: 1744, height: 915 }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "漫镜 · 多 AI 协作生成漫剧",
    description: "支持 LibTV 一键成片、即梦 Seedance 动态镜头与可编辑多轨工作台。",
    images: ["/og-v3.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
