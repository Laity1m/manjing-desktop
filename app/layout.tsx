import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://manjing-ai-comic-studio.lingxiangniao03.chatgpt.site"),
  title: "漫镜 · AI 一键生成漫剧",
  description: "输入一个故事，让 AI 为你完成剧本、分镜、角色、配音与剪辑。",
  openGraph: {
    title: "漫镜 · AI 一键生成漫剧",
    description: "一句话，拍成一部会呼吸的漫剧。",
    images: [{ url: "/og.png", width: 1744, height: 916 }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "漫镜 · AI 一键生成漫剧",
    description: "一句话，拍成一部会呼吸的漫剧。",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
