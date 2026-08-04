import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Gia Đình Tư Hậu — Project Intake",
  description: "Form khởi tạo hợp đồng riêng cho Dự Án Gia Đình Tư Hậu",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
