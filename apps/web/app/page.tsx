import { ProjectIntakeForm } from "../components/project-intake-form";
import { ProjectOperationsPanel } from "../components/project-operations-panel";

export default function HomePage() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">GIA ĐÌNH TƯ HẬU STUDIO</p>
        <h1>Dự Án Gia Đình Tư Hậu</h1>
        <p>Khởi tạo hợp đồng MV người thật · ORIGINAL_FACE_COMPOSITE</p>
      </header>
      <ProjectIntakeForm />
      <ProjectOperationsPanel />
    </main>
  );
}
