# ADR-001: Runtime riêng cho Gia Đình Tư Hậu

## Trạng thái

Đã chấp thuận — 2026-08-04.

## Quyết định

Web Form ghi trực tiếp hợp đồng đã xác nhận vào `GIA_DINH_TU_HAU_DATABASE_V1`
và tạo cấu trúc Drive dưới `GIA_DINH_TU_HAU_STUDIO`. Không có webhook trung gian.

`ORIGINAL_FACE_COMPOSITE` là pipeline giữ gương mặt duy nhất. MV người thật là lộ
trình sản xuất hiện hành; Web Drama chưa được phép khởi tạo từ giao diện.

## Hệ quả

- Mỗi lần xác nhận có `submission_id` để chống tạo trùng.
- `project_id` chỉ dùng tiền tố `GDTH-*`.
- Dữ liệu cũ bị cô lập và không còn được tham chiếu bởi mã nguồn hay cấu hình.
