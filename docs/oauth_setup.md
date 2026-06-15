# OAuth 登入設定指南

憑證填入 `/Users/jimweng/Desktop/growsmart/.env`（此檔案已在 `.gitignore`，不會被 commit）。

---

## Google OAuth

**取得憑證：**

1. 打開 [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
2. 找 OAuth 2.0 Client ID → 點進去
3. **Authorized redirect URIs** 加入：
   ```
   http://localhost:8090/auth/google/callback
   ```
4. 複製 **Client ID** 和 **Client Secret**

**填入 `.env`：**

```env
GOOGLE_CLIENT_ID=你的Client ID
GOOGLE_CLIENT_SECRET=你的Client Secret
```

---

## Facebook OAuth

**建立 App：**

1. 打開 [developers.facebook.com](https://developers.facebook.com) → **My Apps** → **Create App**
2. 選 **Consumer** → 填 App name（如 GrowSmart）
3. 左側 **Add a Product** → **Facebook Login** → **Set Up** → **Web**
4. Site URL 填 `http://localhost:8090`
5. 左側 **Facebook Login → Settings** → **Valid OAuth Redirect URIs** 加入：
   ```
   http://localhost:8090/auth/facebook/callback
   ```
6. 左側 **Settings → Basic** → 複製 **App ID** 和 **App Secret**

**填入 `.env`：**

```env
FACEBOOK_CLIENT_ID=你的App ID
FACEBOOK_CLIENT_SECRET=你的App Secret
```

> **注意：** Facebook 開發模式下只有你（App 管理員）可以登入。要讓其他人登入需要提交 App 審核。

---

## LINE OAuth

**建立 LINE Login Channel：**

1. 打開 [LINE Developers Console](https://developers.line.biz/console/)
2. 左側 **Providers** → **Create** → 填 Provider 名稱（如 GrowSmart）
3. 點進 Provider → **Create a new channel** → 選 **LINE Login**
4. 填入：
   - Channel name: GrowSmart
   - Channel description: 兒童成長追蹤
   - App types: 勾選 **Web app**
5. 建立後點進 Channel → **LINE Login** 分頁
6. **Callback URL** 加入：
   ```
   http://localhost:8090/auth/line/callback
   ```
7. 點 **Basic settings** 分頁 → 複製 **Channel ID** 和 **Channel secret**

**填入 `.env`：**

```env
LINE_CLIENT_ID=你的Channel ID
LINE_CLIENT_SECRET=你的Channel secret
```

> **注意：** LINE OAuth 不回傳 email（LINE 不允許直接取得 email），使用者以 LINE userId 識別身份。

---

## 完整 `.env` 範例

```env
# 伺服器設定
BASE_URL=http://localhost:8090

# Google OAuth
GOOGLE_CLIENT_ID=283306004097-xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx

# Facebook OAuth
FACEBOOK_CLIENT_ID=123456789
FACEBOOK_CLIENT_SECRET=abcdef123456

# LINE OAuth
LINE_CLIENT_ID=1234567890
LINE_CLIENT_SECRET=abcdef1234567890abcdef1234567890
```

---

## 重啟服務

填完 `.env` 後執行：

```bash
cd /Users/jimweng/Desktop/growsmart
docker compose --env-file .env up -d --build
```

---

## 正式環境設定

上線後 `BASE_URL` 改為真實 domain，各 OAuth 的 redirect URI 也要同步更新為正式 URL。
