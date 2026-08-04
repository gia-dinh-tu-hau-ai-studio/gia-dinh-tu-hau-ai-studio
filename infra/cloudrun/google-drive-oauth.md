# OAuth Google Drive cho Cloud Run

## Mục tiêu

Google Sheets tiếp tục dùng service account của `ai-executor-api`. Riêng Google Drive
dùng OAuth của chủ sở hữu My Drive để file JSON được tính vào dung lượng của người dùng,
không phải service account.

Biến runtime duy nhất là `GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON`. Giá trị phải là JSON
`authorized_user` có `client_id`, `client_secret` và `refresh_token`; chỉ lưu trong
Secret Manager.

Scope `drive` cho phép OAuth client truy cập Drive của tài khoản đã cấp quyền. Runtime
chỉ chấp nhận project folder là con trực tiếp của
`GIA_DINH_TU_HAU_PROJECTS_FOLDER_ID`, nhưng vẫn nên dùng một tài khoản vận hành riêng
nếu có thể để giảm phạm vi dữ liệu của credential.

## Tạo credential một lần

1. Trong Google Auth Platform, tạo OAuth client loại **Desktop app** cho project
   `tu-hau-ai-music`, rồi tải file client JSON về Cloud Shell.
2. Đưa ứng dụng OAuth sang trạng thái Production hoặc bảo đảm tài khoản vận hành là test
   user theo chính sách hiện hành của Google.
3. Trong Cloud Shell, chạy luồng đăng nhập bằng chính tài khoản sở hữu thư mục dự án:

```bash
gcloud auth application-default login \
  --client-id-file="$HOME/oauth-client.json" \
  --scopes="https://www.googleapis.com/auth/drive"
```

Không gửi file OAuth, client secret hoặc refresh token qua chat.

## Lưu credential trong Secret Manager

```bash
PROJECT_ID="tu-hau-ai-music"
SECRET_NAME="gia-dinh-tu-hau-drive-oauth"
API_SERVICE_ACCOUNT="gia-dinh-tu-hau-ai-executor@tu-hau-ai-music.iam.gserviceaccount.com"
ADC_FILE="$HOME/.config/gcloud/application_default_credentials.json"

gcloud config set project "$PROJECT_ID"
jq -e '
  .type == "authorized_user" and
  (.client_id | length > 0) and
  (.client_secret | length > 0) and
  (.refresh_token | length > 0)
' "$ADC_FILE" >/dev/null

gcloud secrets describe "$SECRET_NAME" >/dev/null 2>&1 || \
  gcloud secrets create "$SECRET_NAME" --replication-policy=automatic

gcloud secrets versions add "$SECRET_NAME" --data-file="$ADC_FILE"

gcloud secrets add-iam-policy-binding "$SECRET_NAME" \
  --member="serviceAccount:$API_SERVICE_ACCOUNT" \
  --role="roles/secretmanager.secretAccessor"
```

## Gắn secret và kiểm tra

```bash
gcloud run services update ai-executor-api \
  --project="tu-hau-ai-music" \
  --region="asia-southeast1" \
  --update-secrets="GOOGLE_DRIVE_OAUTH_CREDENTIALS_JSON=gia-dinh-tu-hau-drive-oauth:latest" \
  --quiet
```

Sau khi revision mới sẵn sàng, gọi `/v1/health`, rồi gọi lại endpoint
`prepare-mv-production`. Endpoint idempotent: một dự án chỉ có một job, một approval và
một manifest ở trạng thái đang chờ duyệt.

Chỉ xóa file client JSON và ADC cục bộ sau khi secret đã được gắn và endpoint được xác
minh thành công.
