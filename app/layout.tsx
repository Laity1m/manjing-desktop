import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://manjing-ai-comic-studio.lingxiangniao03.chatgpt.site"),
  title: "漫镜 · 多 AI 协作生成漫剧",
  description: "导演、编剧、生图、视频、配音与剪辑六个 AI 岗位协作，生成可播放、可剪辑的 AI 漫剧。",
  openGraph: {
    title: "漫镜 · 多 AI 协作生成漫剧",
    description: "六个 AI 岗位各司其职，也支持接入你自己的模型接口。",
    images: [{ url: "/og-v2.png", width: 1744, height: 916 }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "漫镜 · 多 AI 协作生成漫剧",
    description: "六个 AI 岗位各司其职，也支持接入你自己的模型接口。",
    images: ["/og-v2.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
