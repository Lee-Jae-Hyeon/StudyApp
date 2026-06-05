import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 학습 어시스턴트",
  description: "AI 요약, 노트, 타이머, 캐릭터 성장, 학습 통계를 제공하는 개인 학습 도구"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
