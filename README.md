# GrowSmart — 兒童成長追蹤平台

AI 驅動的兒童成長曲線分析工具。記錄身高體重、對照 WHO 百分位、AI 成長顧問對話。

## 架構

```
瀏覽器 → http://localhost:8090
              ↓
    [Docker] growsmart-app  (Go server)
              ↓ DB
    [Docker] growsmart-db   (PostgreSQL :5434)
              ↓ AI 問題
    [Host]   claude-proxy   (:9999)
              ↓
    [Host]   claude CLI
```

- **app + db**：Docker Compose 管理
- **claude-proxy**：host 上獨立跑，橋接 container → claude CLI

---

## 啟動流程

### 1. 啟動 Docker 服務（app + db）

```bash
make up
```

### 2. 啟動 claude-proxy（tmux session，保持背景運行）

```bash
tmux new -s growsmart-proxy
make proxy
# Ctrl+B 再按 D → detach，session 繼續跑
```

> AI 成長顧問需要 proxy 持續運行。關掉 terminal 前先 detach，不要直接關視窗。

### 重新 attach proxy session

```bash
tmux attach -t growsmart-proxy
```

### 查看所有 tmux sessions

```bash
tmux ls
```

---

## 停止服務

```bash
make down                        # 停 Docker containers
tmux kill-session -t growsmart-proxy  # 停 proxy
```

---

## 環境需求

- Docker + Docker Compose
- Go 1.22+
- [claude CLI](https://claude.ai/code) — 已登入且可執行 `claude -p`

---

## 常用指令

| 指令 | 說明 |
|------|------|
| `make up` | 啟動 app + db（Docker） |
| `make down` | 停止 Docker containers |
| `make proxy` | 啟動 claude-proxy（host） |
| `make build` | 編譯 server binary |

---

## 環境變數

Docker Compose 自動帶入，無需手動設定。若需覆寫：

| 變數 | 預設值 | 說明 |
|------|--------|------|
| `PROXY_PORT` | `9999` | claude-proxy 監聽 port |
| `PORT` | `8090` | app server port |
| `ANTHROPIC_API_KEY` | （選填）| 直打 API fallback |

---

## 功能

- WHO 成長曲線（0–18 歲，身高；0–10 歲，體重）
- 百分位計算與說明 modal
- 遺傳靶身高（MPH）預測區間
- 成長偏差警示（跨百分位帶 / 年增量不足）
- 生活建議卡（睡眠、運動、營養）
- AI 成長顧問（對話歷史持久化至 DB）

---

## 🎨 介面重構與法規合規優化 (2026-06)

為了提高易讀性並防範法律糾紛風險，平台進行了以下重大重構：

### 1. 成長概覽分頁化與自適應
為了解決原本首頁資訊過度飽和的問題，我們將「成長概覽」拆分為三個子分頁，並透過動態漸顯動畫進行切換：
*   **📊 成長現況**：著重顯示核心數據（最新身高體重、百分位徽章、年化成長速率、遺傳靶身高 MPH 與成人身高預測）及異常警訊/里程碑。
*   **🥗 日常照護**：睡眠與運動計畫，以及基於體重與百分位自動計算的 **DRI（每日營養素攝取量）個人化計算機**。行動裝置上自動堆疊為垂直好讀卡片。
*   **🏥 專業指引**：
    *   *身高百分位落後（P15 以下）*：自動啟用**追趕生長飲食建議**（附 AI 個人化對話引導按鈕）。
    *   *身高百分位極低（P3 以下）*：自動啟用**就醫評估建議清單**（指引就醫門診與醫師可能執行的檢查）。
    *   *生長指標正常*：動態呈現 **「健康良好評估卡 🌟」** 提供家長安心正向反饋與維持建議。

### 2. 隱私安全與個資法合規
*   **🔒 敏感個資同意**：在「新增/編輯孩子表單」中加入了隱私政策同意勾選框。系統進行強置驗證，家長必須同意儲存孩子生長敏感數據才能建立檔案。
*   **📄 條款與政策 Modal**：內置 GrowSmart 服務條款與隱私權個資政策說明，點擊連結時自動開啟彈窗（支援滾動閱讀與 `Esc` 鍵關閉）。

### 3. 全域醫療免責聲明
*   **頁尾免責宣告**：儀表板底部常設醫療免責條款，告知平台建議無法替代實體兒科醫師診斷。
*   **AI 顧問提示**：在 AI 諮詢視窗頂部加入黃色警告提示盒，告知 AI 回覆僅屬科普知識，排除直接診斷之醫療責任。
