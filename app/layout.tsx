import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "漫镜 · AI 一键生成漫剧",
  description: "输入一个故事，让 AI 为你完成剧本、分镜、角色、配音与剪辑。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
