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
