import { ProjectIntakeForm } from "../components/project-intake-form";

export default function HomePage() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">AI ENTERTAINMENT STUDIO</p>
        <h1>Dự Án Gia Đình Tư Hậu</h1>
        <p>Form đầu vào dùng chung v1.0 · tương thích kiến trúc 331</p>
      </header>
      <ProjectIntakeForm />
    </main>
  );
}
