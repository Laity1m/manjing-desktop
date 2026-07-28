import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://manjing-ai-comic-studio.lingxiangniao03.chatgpt.site"),
  title: "漫镜 · AI 一键生成漫剧",
  description: "从角色资产、一致性分镜、动态表演到分角色配音与配乐，一键生成可播放 AI 漫剧。",
  openGraph: {
    title: "漫镜 · AI 一键生成漫剧",
    description: "角色一致、人物会动、声音完整的 AI 漫剧生产线。",
    images: [{ url: "/og-v2.png", width: 1744, height: 916 }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "漫镜 · AI 一键生成漫剧",
    description: "角色一致、人物会动、声音完整的 AI 漫剧生产线。",
    images: ["/og-v2.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
