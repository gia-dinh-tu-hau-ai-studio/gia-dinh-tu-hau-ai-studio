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
9. Endpoint duyệt kế hoạch cập nhật đúng job thành `APPROVED`, dòng
   `APPROVALS/APPROVED`, approval gate trong manifest, ghi audit
   `MV_PRODUCTION_PLAN_APPROVED` và chuyển `next_action` sang
   `PREPARE_MV_ASSETS`. Dự án vẫn ở `PRE_PRODUCTION`; bước này chưa render và
   chưa gọi provider. Gọi lại cùng dự án là idempotent.
10. Endpoint `POST /v1/projects/:projectId/prepare-mv-assets` nhận Drive ID hoặc
    link beat/instrumental master, kiểm tra beat, lyrics và video gốc
    `ORIGINAL_FACE_COMPOSITE`, rồi tạo `MV_ASSET_MANIFEST_V1` ở trạng thái
    `AWAITING_APPROVAL`/`APPROVE_MV_ASSETS`. File nguồn không bị sao chép; render
    và provider vẫn bị khóa.
11. Endpoint `POST /v1/projects/:projectId/approve-mv-assets` duyệt manifest tài
    sản, khóa nguồn Tường Vy là tạm thời với `close_up_allowed=false`, ghi audit
    `MV_ASSETS_APPROVED` và chuyển `next_action` sang `PREPARE_MV_SHOT_PLAN`.
    Dự án vẫn ở `PRE_PRODUCTION`; render và provider tiếp tục bị khóa.
12. Sau khi Shot Plan và Timecode Alignment đã được duyệt, endpoint
    `POST /v1/projects/:projectId/prepare-mv-render-plan` tạo 15 render units phủ
    đủ 371.62 giây. Mỗi unit ở trạng thái `BLOCKED_PENDING_APPROVAL`; cảnh có
    Tường Vy tiếp tục cấm cận mặt, chỉ `MEDIUM/FULL_BODY` và giữ microphone.
    Render Plan chuyển sang `APPROVE_MV_RENDER_PLAN`; provider và render vẫn khóa.
13. Endpoint `POST /v1/projects/:projectId/approve-mv-render-plan` duyệt đúng
    manifest 15 render units, cập nhật job/approval/audit và chuyển sang
    `PREPARE_MV_RENDER_EXECUTION`. Các unit vẫn bị chặn chờ chuẩn bị thực thi;
    provider và render tiếp tục là `false`.
14. Endpoint `POST /v1/projects/:projectId/prepare-mv-render-execution` tạo hồ sơ
    thực thi cho đúng 15 render units và chuyển sang `APPROVE_MV_RENDER_EXECUTION`.
    Tất cả units vẫn khóa chờ duyệt; chưa gọi provider và chưa render.
15. Endpoint `POST /v1/projects/:projectId/approve-mv-render-execution` ghi nhận
    quyền thực thi và chuyển sang `PREPARE_MV_PROVIDER_SUBMISSION`. Provider và
    render vẫn khóa cho đến bước chuẩn bị submission riêng.
16. Endpoint `POST /v1/projects/:projectId/prepare-mv-provider-submission` kiểm tra
    hồ sơ thực thi đã duyệt, tạo đúng 15 payload Runway ở trạng thái bị khóa và
    chuyển sang `APPROVE_MV_PROVIDER_SUBMISSION`. Bước này không gọi API Runway,
    không truyền tài sản ra ngoài và chưa render.
17. Endpoint `POST /v1/projects/:projectId/approve-mv-provider-submission` duyệt
    gói 15 payload và chuyển sang `SUBMIT_MV_PROVIDER_JOBS`. Việc duyệt không tự
    gọi Runway; provider và render vẫn khóa cho đến lệnh submit riêng.
18. Endpoint `POST /v1/projects/:projectId/prepare-mv-provider-pilot` chỉ chọn
    cảnh song ca `RP015` dài 9.62 giây để đánh giá hai gương mặt. Pilot Aleph 2.0
    dự toán tối đa 270 credit (~2.70 USD), giữ khóa Tường Vy và vẫn chờ media,
    prompt cùng duyệt ngân sách; chưa gọi Runway, chưa upload và chưa tiêu credit.

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
