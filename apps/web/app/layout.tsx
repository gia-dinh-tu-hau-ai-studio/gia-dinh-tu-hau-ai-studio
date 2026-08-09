import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "TuhauAI — Khởi tạo dự án",
  description: "Biểu mẫu di động để khởi tạo dự án Phim ngắn, Web Drama và Âm nhạc",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
