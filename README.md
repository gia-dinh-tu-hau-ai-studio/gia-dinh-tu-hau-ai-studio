# Dự Án Gia Đình Tư Hậu — AI Entertainment Studio

Mã nguồn nền cho sprint `AI_EXECUTOR-01`, bám theo `MASTER_PLAN_AI_ENTERTAINMENT_STUDIO_v1.0` và kiến trúc AI Music Factory 331.

## Phạm vi hiện tại

- Form đầu vào dùng chung cho `SHORT_FILM`, `MUSIC_VIDEO` và `SHORT_MUSIC_CLIP`.
- Chuẩn hóa `SHORT_MUSIC_CLIP` thành `project_type=MUSIC_VIDEO` và `project_subtype=SHORT_MUSIC_CLIP`.
- API NestJS chỉ nhận contract chuẩn hóa; không đọc/ghi trực tiếp nội bộ workflow 331.
- PostgreSQL cho dữ liệu vận hành của AI Executor.
- Redis + BullMQ cho hàng đợi công việc.
- Google Drive connector dùng API chính thức.
- Khối `NHÂN VẬT & VAI TRÒ` chỉ đọc từ `11_CHARACTER_LIBRARY`, lọc
  `ACTIVE + IMAGE_READY + LEGAL_CLEARED` và không nhận tên nhân vật tự do.
- Backend kiểm tra character, costume và voice trước khi chuyển sang `AI_MUSIC_FACTORY`.
- Nhân vật chưa có costume vẫn được chọn; chỉ costume có trạng thái `APPROVED`
  mới được đưa vào payload.
- Docker Compose cho môi trường phát triển.

Sprint này không thay đổi workflow 331, không thêm node và không thêm cột Google Sheets.

## Khởi động nhanh

```bash
cp .env.example .env
npm install
npm run test
docker compose up --build
```

Sau khi chạy:

- Form: `http://localhost:3000`
- API health: `http://localhost:3001/v1/health`

Google Drive connector chỉ hoạt động sau khi cấu hình quyền và thông tin xác thực hợp lệ.

Để đọc Character Library, cấu hình thêm `GOOGLE_SHEETS_DATABASE_ID`,
`GOOGLE_SERVICE_ACCOUNT_JSON` và
`CHARACTER_LIBRARY_SHEET_NAME=11_CHARACTER_LIBRARY`. Khi chưa cấu hình, API trả mã
kiểm soát `CHARACTER_LIBRARY_NOT_CONFIGURED`.
