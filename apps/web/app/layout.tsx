import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Gia Đình Tư Hậu — Project Intake",
  description: "Form đầu vào dùng chung theo kiến trúc 331",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
