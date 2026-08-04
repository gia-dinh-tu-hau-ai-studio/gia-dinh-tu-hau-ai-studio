# Dự Án Gia Đình Tư Hậu

Hệ thống này chỉ phục vụ một dự án: **Gia Đình Tư Hậu**.

## Nguyên tắc vận hành đã khóa

- Sản xuất MV ca nhạc với nhân vật thật trước.
- Web Drama tạm khóa cho đến khi quy trình MV đạt yêu cầu.
- Giữ danh tính gương mặt bằng `ORIGINAL_FACE_COMPOSITE`.
- Không gọi workflow, webhook hoặc cơ sở dữ liệu của hệ thống cũ.
- Không dùng kiến trúc sản xuất cũ.

## Luồng tạo dự án

1. Web Form kiểm tra hợp đồng đầu vào và nhân vật đủ điều kiện trong `CHARACTER_LIBRARY`.
2. Người dùng bấm xác nhận tạo dự án.
3. API tạo `project_id` dạng `GDTH-MV-*`, thư mục Drive riêng và ghi hợp đồng vào `PROJECTS`.
4. Các nhân vật được ghi vào `PROJECT_CHARACTERS`; sự kiện được ghi vào `AUDIT_LOG`.
5. Trạng thái đầu tiên là `CONTRACT`, hành động tiếp theo là `APPROVE_CONTRACT`.
6. Nút duyệt hợp đồng cập nhật đúng dòng theo `project_id`, ghi sự kiện
   `CONTRACT_APPROVED`, rồi chuyển sang `PRE_PRODUCTION` với hành động
   `PREPARE_MV_PRODUCTION`. Gọi lại cùng `project_id` không ghi lặp sự kiện.

Yêu cầu cấu hình nằm trong `.env.example`. Runtime Cloud Run dùng Google Application
Default Credentials; chỉ dùng `GOOGLE_SERVICE_ACCOUNT_JSON` cho môi trường ngoài Google
Cloud khi thật sự cần.

## Chạy kiểm tra

```bash
npm ci
npm test
npm run typecheck
npm run build
```
