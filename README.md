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
7. Nút lập kế hoạch PRE_PRODUCTION kiểm tra hợp đồng MV đã duyệt, video gốc của
   từng nhân vật và `ORIGINAL_FACE_COMPOSITE`; sau đó tạo
   `MV_PRODUCTION_PLAN_V1_<project_id>.json` trong `02_SAN_XUAT_MV`.
8. Kế hoạch được ghi vào `PRODUCTION_JOBS` ở trạng thái `AWAITING_APPROVAL`, tạo
   một dòng `APPROVALS/PENDING`, ghi audit `MV_PRODUCTION_PLAN_PREPARED` và đổi
   `next_action` thành `APPROVE_MV_PRODUCTION_PLAN`. Gọi lại cùng dự án không tạo
   thêm job, approval hoặc manifest.

Gate PRE_PRODUCTION chỉ chuẩn bị hồ sơ để con người duyệt. Nó không render nội
dung, không gọi nhà cung cấp và không cho phép bắt đầu Web Drama.

Yêu cầu cấu hình nằm trong `.env.example`.

- Google Sheets dùng Application Default Credentials của service account Cloud Run;
  `GOOGLE_SERVICE_ACCOUNT_JSON` chỉ dành cho môi trường ngoài Google Cloud.
- Google Drive dùng OAuth của chủ sở hữu My Drive qua
  `GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON`. Biến này chỉ nhận JSON
  `type=authorized_user` và phải được gắn từ Secret Manager. Không đưa client secret
  hoặc refresh token vào GitHub, image hay biến môi trường dạng văn bản thường.
- Quy trình tạo và gắn secret được mô tả tại
  [`infra/cloudrun/google-drive-oauth.md`](infra/cloudrun/google-drive-oauth.md).

## Chạy kiểm tra

```bash
npm ci
npm test
npm run typecheck
npm run build
```
