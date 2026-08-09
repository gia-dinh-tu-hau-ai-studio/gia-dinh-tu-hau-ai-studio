import { ProjectIntakeForm } from "../components/project-intake-form";

export default function HomePage() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">TƯ HẬU AI STUDIO</p>
        <h1>TuhauAI</h1>
        <p>Khởi tạo dự án sáng tạo ngay trên điện thoại</p>
      </header>
      <ProjectIntakeForm />
    </main>
  );
}
