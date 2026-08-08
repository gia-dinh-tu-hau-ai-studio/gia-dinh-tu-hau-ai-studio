import { ProjectIntakeForm } from "../components/project-intake-form";

export default function HomePage() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">GIA ĐÌNH TƯ HẬU STUDIO</p>
        <h1>Dự Án Gia Đình Tư Hậu</h1>
        <p>Khởi tạo phim ngắn · Character Master · Approval Gates</p>
      </header>
      <ProjectIntakeForm />
    </main>
  );
}
