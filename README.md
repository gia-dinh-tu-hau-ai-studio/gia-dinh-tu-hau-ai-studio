# TuhauAI — Gia Đình Tư Hậu

Hệ thống tập trung duy nhất vào **phim ngắn và Web Drama**.

## Nguyên tắc vận hành

- Form mobile-first dùng `SHORT_FILM_FORM_V1`.
- OpenAI tạo bản nháp kịch bản từ ý tưởng; chủ dự án phải duyệt trước Shot Plan.
- Chỉ dùng Character Master `APPROVED + LOCKED` và Voice Master đã duyệt.
- Runway tạo chuyển động, ElevenLabs tạo thoại và Sync xử lý khẩu hình sau các cổng duyệt tương ứng.
- Pilot đại diện phải được duyệt trước khi mở sản xuất toàn phim.
- Mọi provider call đều cần cổng ngân sách riêng; secret chỉ được đọc từ runtime.

## Luồng dự án

1. Nhập thông tin dự án và chọn nhân vật hợp lệ từ `CHARACTER_LIBRARY`.
2. Kiểm tra tài khoản, duyệt kinh phí và tạo dự án `GDTH-FILM-*`.
3. Duyệt hợp đồng và toàn bộ kịch bản.
4. Tạo, review và duyệt Shot Plan.
5. Khóa Character Master, Voice Master, người nói và keyframe.
6. Tạo audio để nghe duyệt, rồi tạo các clip pilot đại diện.
7. QC identity, diễn xuất, chuyển động, khẩu hình, giọng, bối cảnh, ánh sáng và continuity.
8. Chỉ khi pilot đạt mới được duyệt ngân sách và sản xuất toàn phim.
9. QC phim hoàn chỉnh trước khi xuất bản.

Google Sheets dùng Application Default Credentials. Google Drive dùng OAuth chủ sở hữu qua secret `GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON`; không đưa khóa vào source, image hoặc GitHub.

## Kiểm tra

```bash
npm ci
npm test
npm run typecheck
npm run build
```
