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
                              ├── contest scheduler（自動開始/結束）
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
setup ──(start_contest)──▶ running ──(end_contest)──▶ ended
   ▲                                                     │
   └────────────────── reset ────────────────────────────┘
```

- `setup`：管理員可改題目、參賽者、時間
- `running`：開始輪詢 + 計分 + 推播
- `ended`：不再進新得分，前端切換到結束畫面，後端持續寬限期收尾

排程器（`scheduler.py`）會主動觀察 `start_time` / `end_time`，到點自動 transition，不必管理員精準在秒上按按鈕。

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
  - `system_event`（admin only）
  - `contest_reset`
- EventSource 自動重連；前端在重連後額外 `GET /api/snapshot` 重新對齊狀態，避免畫面跟後端飄離。

---

## 4. 計分規則

每位參賽者對每題：

1. **基礎分**：第一次在比賽時間內 AC，加上題目設定的 `points`（即時觸發）
2. **Beat-% 加分**：可選功能，每題可設多階加分區間（`beat_bonus_tiers`），例如 `≥95% → +3`、`≥80% → +2`、`≥60% → +1`。
   - 第一次 AC 時直接套用對應階級
   - 之後同題再 AC，若 beat % 進步到更高階，**只補加差額**（不會重複加基礎分）
3. **時間外 AC 不計分**：`submittedAt < start_time` 或 `> end_time` 的 submission 一律不算，但仍會記錄成事件
4. **重複 dedupe**：同一個 `submission_id` 即使被多次輪詢拉到，也只計一次

排名規則：分數高優先，分數相同時以「達到目前分數的時間」較早者勝出。分數 0 並列。

---

## 5. JSON 持久化

- 檔案：`data/contest.json`，備份：`data/contest.json.bak`
- 寫入：序列化 → 寫到 `.tmp` → `os.replace` → 失敗時直接 fallback 到 `.bak`
- 讀取：boot 時優先讀 `contest.json`，壞檔時讀 `.bak`，再壞就用 `default_contest()` 起一個空的 setup
- 寫入合併：200ms 內的多次 `mark_dirty` 只會落盤一次。狀態機轉換、比賽開始/結束、reset 一律強制 flush。

---

## 6. 本機開發

### 後端（Python ≥ 3.11）

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'

cp .env.example .env
# 編輯 .env：至少填 ADMIN_TOKEN

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
pytest -q              # 19 個 scoring / ranking / bonus / persistence 測試
cd frontend && npm run lint   # tsc -b 型別檢查
```

---

## 7. 真實比賽開賽流程

1. 把 `LEETCODE_SESSIONS` 填上（一個 LEETCODE_SESSION cookie 就夠用，多個會自動 round-robin + cooldown）。沒填也可以跑，只是不會抓到 beat-% bonus。
2. 確認 `ADMIN_TOKEN` 已換成長隨機字串。
3. dashboard：
   - 設定題目（每題可選擇要不要設加分區間）
   - 批量新增參賽者（每行 `username,student_id`）
   - 設定開始 / 結束時間
   - 比賽開始時間到了會自動轉 `running`，要提早結束按「結束比賽」
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

---

## 10. 系統測試清單（手動）

- [ ] 比賽開始前 AC 不計分（手動把開始時間設未來，AC 後再開始）
- [ ] 比賽結束後送進來、但 submittedAt 在期間內 → 計分（觀察 `POST_END_GRACE_SEC` 內的 polling）
- [ ] 同題重複 AC 只算一次基礎分；beat-% 進步時加差額
- [ ] 重啟後端後 `data/contest.json` 還在，狀態恢復一致
- [ ] 殺掉 LeetCode API 連線（防火牆或假 base URL）→ dashboard polling 列出現紅 ⚠，前端不崩
- [ ] dashboard token 錯誤 → 401 + 清掉 localStorage
- [ ] SSE 主動斷線 → 約 1.5–3 秒後自動重連並重抓 snapshot

---

## 11. 已知假設

- 一場比賽 2 小時 / 30–60 人 / 一次性活動
- 一個 token 進 dashboard，沒有多管理員角色
- 比賽過程中題目順序鎖定，沒做題序變更動畫
- 同分排名以「達到該分數時間」決勝（伺服器端，前端只展示）
- 火柴人視覺以 DOM + Framer Motion 為主，30–60 人沒問題；超過約 80 人時，前端會自動橫向收緊間距
- 沒有「賽前是否已 AC 過題目」的檢查（需要參賽者本人的 LEETCODE_SESSION，不可行）
