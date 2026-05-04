# GDG on Campus NTUST · LeetCode Contest Scoreboard

即時排行榜 + 投影轉播系統，給社課 / 比賽當天用。後端 FastAPI 持續輪詢 LeetCode submissions，前端 React + Framer Motion 把分數變化做成「小朋友上樓梯」動畫，全程 SSE 推播。

- 公開計分板：`https://leetcode.gdg-ntust.org/`（投影機畫面，1920×1080）
- 管理員 dashboard：`https://leetcode.gdg-ntust.org/dashboard`
- 後端 API：`https://api-leetcode.gdg-ntust.org/api/...`

---

## 1. 整體架構

```
Public scoreboard ──SSE── ┐
Admin dashboard   ──SSE── ┴── FastAPI backend ── httpx ── leetcode-api-pied
                              │
                              ├── polling worker（asyncio）
                              ├── pre-check worker
                              ├── scoring engine（伺服器端唯一計分權威）
                              └── atomic JSON store（data/contest.json + .bak）
```

- 前端不計分。所有分數、排名都來自 `/api/snapshot` 與 SSE 推播。
- 背景 worker 任何單點失敗都會被吞下並 log，不會把整場比賽搞掛。
- 比賽進行中即時 mirror 到 `data/contest.json`，每次寫入用 `tmp + os.replace` 原子化，並保留 `.bak`。後端重啟可以從 JSON 恢復狀態。
- 比賽結束後仍會輪詢 `POST_END_GRACE_SEC` 秒（預設 90），補抓 `submittedAt` 在比賽期間內、但伺服器是在結束後才看到的 AC submission。

---

## 2. 主要狀態流

```
setup ──(begin_precheck)──▶ precheck ──(start_contest)──▶ running ──(end_contest)──▶ ended
   ▲                            │                                                       │
   └──────── reset ─────────────┴───────────────────────────────────────────────────────┘
```

- `setup`：管理員可改題目、參賽者、時間
- `precheck`：背景檢查每位參賽者是否曾經 AC 過比賽題目（hint，不自動扣分）
- `running`：開始輪詢 + 計分 + 推播
- `ended`：不再進新得分，前端切換到結束畫面，後端持續寬限期收尾

---

## 3. 即時推播

- SSE，路徑：
  - 公開：`GET /api/stream`
  - 管理員：`GET /api/admin/stream?token=...`（EventSource 不能下 header，故用 query string）
- 連線一進來先送 `snapshot` 完整狀態，之後增量推：
  - `leaderboard_update`
  - `submission_event`
  - `contest_status` / `times_updated` / `problems_updated`
  - `polling_status`（admin only）
  - `precheck_update`（admin only）
  - `system_event`（admin only）
- EventSource 自動重連；前端在重連後額外 `GET /api/snapshot` 重新對齊狀態，避免畫面跟後端飄離。

---

## 4. JSON 持久化

- 檔案：`data/contest.json`，備份：`data/contest.json.bak`
- 寫入：序列化 → 寫到 `.tmp` → `os.replace` → 失敗時直接 fallback 到 `.bak`
- 讀取：boot 時優先讀 `contest.json`，壞檔時讀 `.bak`，再壞就用 `default_contest()` 起一個空的 setup
- 寫入合併：200ms 內的多次 `mark_dirty` 只會落盤一次。狀態機轉換、比賽開始/結束、reset 一律強制 flush。

---

## 5. 本機開發

### 後端（Python ≥ 3.11）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

cp .env.example .env
# 編輯 .env：至少填 ADMIN_TOKEN

# 預設 .env 範例已用 MOCK_MODE=true，啟動後不會打 LeetCode API
uvicorn app.main:app --reload --port 8080
```

打開 `http://localhost:8080/api/health` 應該回 `{"ok":true}`。

### 前端（Node 20+）

```bash
cd frontend
npm install
npm run dev    # http://localhost:5173
```

Vite dev server 會把 `/api/*` proxy 到 `http://localhost:8080`。打開
`http://localhost:5173/` 看計分板，`/dashboard` 進管理員介面。

### 跑測試

```bash
pytest -q              # 7 個 scoring / ranking / persistence 測試
cd frontend && npm run lint   # tsc -b 型別檢查
```

---

## 6. Mock mode 演練流程

不打真 API，全程用本機 JSON 演算法跑出一場「假比賽」，可放投影機練動畫。

1. `.env` 設 `MOCK_MODE=true`、`MOCK_SCRIPT_PATH=./mock/sample.json`
2. 啟動後端 + 前端（如上）
3. 開 `http://localhost:5173/dashboard`，貼 token 登入
4. 在 dashboard：
   - 設定開始 / 結束時間（例如：開始 = 現在 + 30 秒）
   - 批量新增 `alice,B11000001` / `bob,B11000002` / `carol,B11000003` / `dan,B11000004`
   - （題目有預設四題，不必改）
   - 按「開始比賽」
5. 開 `http://localhost:5173/` 看公開計分板
6. 30 秒後 mock 開始按 `mock/sample.json` 裡的時間軸送 submission 進來，火柴人就會跳階梯

要改劇本：直接編 `mock/sample.json`，重啟後端會重新讀。

### 客製 mock 劇本

```json
{
  "speed": 1.0,
  "submissions": [
    {"username": "alice", "title_slug": "two-sum", "status": "Accepted", "offset_sec": 5},
    {"username": "bob",   "title_slug": "3sum",    "status": "Wrong Answer", "offset_sec": 10}
  ]
}
```

`speed` > 1 加速、< 1 慢動作。

---

## 7. 真實比賽開賽流程

1. 把 `MOCK_MODE=false` 並填 `LEETCODE_SESSIONS=`（一個 LEETCODE_SESSION cookie 就夠用，多個會自動 round-robin + cooldown）。
2. 確認 `ADMIN_TOKEN` 已換成長隨機字串。
3. dashboard：
   - 設定題目（只能在比賽前改）
   - 批量新增參賽者
   - 設定開始 / 結束時間
   - 按「執行賽前檢查」→ 等 dashboard 出現結果（partial 結果會顯示橘色警示）
   - 比賽開始前 30 秒按「開始比賽」
   - 結束時間到了會自然封盤；要提早結束按「結束比賽」
4. 比賽中可隨時用「推播刷新」強制把所有 SSE 客戶端重新對齊。
5. 異常時：`/api/admin/snapshot` 一定能拿到當前完整狀態；後端重啟也會從 JSON 恢復。

---

## 8. 部署

### 後端（自架）

任何能跑 Python 3.11+ + 有 stable filesystem 的機器都可以。範例 systemd unit：

```ini
[Service]
WorkingDirectory=/srv/gdg-leetcode
EnvironmentFile=/srv/gdg-leetcode/.env
ExecStart=/srv/gdg-leetcode/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
Restart=always
```

對外用 nginx 或 cloudflared 反代到 `https://api-leetcode.gdg-ntust.org`，注意：
- SSE 需要 `proxy_buffering off;`、`proxy_read_timeout` 拉長
- CORS：把 `https://leetcode.gdg-ntust.org` 寫進 `.env` 的 `CORS_ORIGINS`

### 前端（Cloudflare Pages）

```bash
cd frontend
npm install
npm run build  # → dist/
```

把 `dist/` 丟上 Cloudflare Pages（或 `wrangler pages deploy dist`）。`public/_redirects` 已經把 SPA fallback + `/api/*` 代理寫好：

```
/api/*  https://api-leetcode.gdg-ntust.org/api/:splat  200
/*      /index.html                                    200
```

如果你不想讓 Pages 代 API（直連跨域也可以），把第一行刪掉，並設 `VITE_API_BASE=https://api-leetcode.gdg-ntust.org` 在 build env，後端 `CORS_ORIGINS` 加上 frontend domain。

---

## 9. 環境變數一覽

| Var | 預設 | 說明 |
| --- | --- | --- |
| `ADMIN_TOKEN` | `change-me` | dashboard 登入用 |
| `LEETCODE_SESSIONS` | `""` | LEETCODE_SESSION cookie，逗號分隔多個 |
| `LEETCODE_API_BASE` | `https://leetcode-api-pied.vercel.app` | API 來源 |
| `DATA_DIR` | `./data` | JSON 持久化資料夾 |
| `POLL_INTERVAL_SEC` | `5` | 每位使用者輪詢間隔 |
| `POLL_RECENT_LIMIT` | `5` | 每次輪詢取的 submission 筆數 |
| `POLL_JITTER` | `0.2` | 抖動，避免同步突發 |
| `POST_END_GRACE_SEC` | `90` | 結束後仍輪詢的寬限期 |
| `LEETCODE_HTTP_TIMEOUT_SEC` | `10` | httpx 超時 |
| `CORS_ORIGINS` | `*` | 逗號分隔，正式環境填具體網域 |
| `MOCK_MODE` | `false` | 切到 mock 模式 |
| `MOCK_SCRIPT_PATH` | `./mock/sample.json` | mock 劇本 |

---

## 10. 系統測試清單（手動）

- [ ] 比賽開始前 AC 不計分（mock 改 offset_sec=-30 驗證）
- [ ] 比賽結束後送進來、但 submittedAt 在期間內 → 計分（mock 把 status 改 Accepted、offset_sec 設 contest 期間內、但 sleep 等到結束後再啟動）
- [ ] 同題重複 AC 只算一次（mock 連續兩筆同 user 同 slug Accepted）
- [ ] 重啟後端後 `data/contest.json` 還在，狀態恢復一致
- [ ] 殺掉 LeetCode API 連線（防火牆或假 base URL）→ dashboard polling 列出現紅 ⚠，前端不崩
- [ ] dashboard token 錯誤 → 401 + 清掉 localStorage
- [ ] SSE 主動斷線 → 約 1.5–3 秒後自動重連並重抓 snapshot

---

## 11. 已知假設

- 一個 token 進 dashboard，沒有多管理員角色
- 比賽過程中題目順序鎖定，沒做題序變更動畫
- 同分排名以「達到該分數時間」決勝（伺服器端，前端只展示）
- mock mode 不做 pre-check（沒有真實 LeetCode session）
- 火柴人視覺以 DOM + Framer Motion 為主，30–60 人沒問題；超過約 80 人時，前端會自動橫向收緊間距
