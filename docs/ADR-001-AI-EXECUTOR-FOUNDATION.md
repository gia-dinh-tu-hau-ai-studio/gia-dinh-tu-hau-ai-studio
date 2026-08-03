# ADR-001 — Nền tảng AI_EXECUTOR-01

- Trạng thái: ĐÃ DUYỆT
- Ngày: 03/08/2026

## Quyết định

- TypeScript monorepo.
- Next.js cho Form đầu vào dùng chung.
- NestJS cho API.
- PostgreSQL cho dữ liệu vận hành AI Executor.
- Redis và BullMQ cho Job Queue.
- Google Drive API chính thức cho connector tài sản.
- Docker Compose cho môi trường triển khai.
- n8n giao tiếp qua REST API, webhook và contract đã khóa.
- Next.js được khóa tại bản `16.3.0-canary.106` vì bản stable hiện tại còn kéo theo cảnh báo bảo mật mức cao ở `postcss` và `sharp`; chuyển về stable ngay khi bản vá chính thức phát hành.

## Ranh giới kiến trúc

- Không thay đổi kiến trúc AI Music Factory 331.
- Không tự thêm workflow hoặc node n8n.
- Không thêm cột Google Sheets trong sprint này.
- Form không tạo `project_id`; AI_MUSIC_FACTORY tạo sau khi đầu vào hợp lệ.
- `SHORT_MUSIC_CLIP` chỉ là lựa chọn giao diện và được chuẩn hóa về `project_type=MUSIC_VIDEO`, `project_subtype=SHORT_MUSIC_CLIP`.
- Google Drive connector không hoạt động nếu chưa có quyền và thông tin xác thực hợp lệ.
