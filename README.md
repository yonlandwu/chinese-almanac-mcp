# Chinese Almanac MCP (中国黄历择日 MCP 服务)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A [Model Context Protocol](https://modelcontextprotocol.io) server for the
Chinese Tung Shing (通勝) almanac — let Claude, Cursor, Windsurf, or any MCP
client plan real-life events with NASA-grade astronomy and the 1739 imperial
canon.

中国传统黄历（通胜）MCP 服务 — 基于协纪辨方书（1739 钦定）与 JPL DE440s
天文级精度引擎，让 Claude / Cursor / 任意 MCP 客户端为你择日择时。

## ✨ Features 功能

- 📅 **Full daily almanac 每日通胜** — lunar date 农历, GanZhi pillars 干支,
  Day Officer 值神（建除十二神）, Yellow/Black Belt 黄黑道, zodiac clash
  冲煞, auspicious/avoid 宜忌, spirits 神煞, Pengzu taboos 彭祖百忌, 28
  mansions 二十八宿
- 💒 **Auspicious date picking 择日** — engine-scored top dates for 8
  real-life events (weddings 嫁娶, moves 搬家, openings 开业, renovations
  动土, C-sections 剖腹产, contract signing / car / home purchases 签约买车
  买房, travel 出行, new jobs 入职), four-tier spirit arbitration
  （協紀辨方書四层仲裁）, 60+ EN/CN synonyms, `weekend_only` filter
- 🕐 **Hour pillars 十二时辰** — Yellow/Black Belt deity per two-hour slot
- 🎯 **Personal lucky hours 个人吉时** — your zodiac × date → ranked hours
  （三合/六合/六冲/六害 × 黄黑道）
- 🐉 **Daily horoscope 生肖日运** — 12 signs, 0-100 score + 8 categories
- 🌾 **24 solar terms 二十四节气** — minute precision (JPL DE440s ephemeris,
  1900–2100)
- 🛡️ **Watermarked, rate-limited API** — data provenance & DMCA-ready
  (server-side engine stays closed-source)

## 🚀 Install 安装

### Claude Desktop / Cursor / any MCP client

Add to `claude_desktop_config.json` / `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "chinese-almanac": {
      "command": "npx",
      "args": ["-y", "chinese-almanac-mcp@latest"]
    }
  }
}
```

**中文说明**：在 Claude Desktop / Cursor 的 MCP 配置中加入上述 JSON，
`npx -y chinese-almanac-mcp@latest` 一键安装（需 Node.js 18+）。

Optional env:

```json
"env": { "TUNGSHING_API_KEY": "tz_xxx" }
```

- Without a key: ±90 days around today 免费窗口 ±90 天
- With a free key: ±365 days（[request a key 申请 Key](https://www.12zodiacs.com/about-us/api/)）

### Install via Smithery (recommended 推荐)

```bash
npx -y @smithery/cli install chinese-almanac-mcp --client claude
```

**中文说明**：通过 Smithery 一键安装到 Claude Desktop / Cursor（`--client` 可选
`claude` / `cursor`）。

### Codex / OpenAI (MCP config)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.chinese-almanac]
command = "npx"
args = ["-y", "chinese-almanac-mcp@latest"]
```

*(npm 包发布后生效；发布前用 `node /path/to/chinese-almanac-mcp/dist/index.js`)*

### Run from source 源码运行

```bash
git clone https://github.com/yonlandwu/chinese-almanac-mcp.git
cd chinese-almanac-mcp && npm install && npm run build
node dist/index.js
```

## 🔧 Tools 工具

| Tool | Description 说明 |
|---|---|
| `get_daily_almanac` | Full almanac for a date 某日完整黄历（农历/干支/值神/黄黑道/冲煞/宜忌/神煞） |
| `get_hour_pillars` | 12 two-hour pillars 十二时辰黄黑道吉凶 |
| `get_solar_terms` | 24 solar terms, minute precision 某年二十四节气（分钟级） |
| `pick_auspicious_dates` | Top dates for an event 择日（8 活动 + 同义词 + weekend_only） |
| `get_daily_horoscope` | Zodiac daily luck 生肖日运（12 生肖） |
| `get_personal_lucky_hours` | Ranked hours for your zodiac 个人吉时（三合六合×黄黑道） |
| `list_activities` | All events + synonyms 活动与同义词清单 |

Example session 示例：

```
User: 我十月想搬家，最好周末，我属马，那天几点最好？
  → pick_auspicious_dates(activity="搬家", days=60, weekend_only=true)
  → get_personal_lucky_hours(zodiac="horse", date="2026-10-18")

User: When should we get married in 2026? Best dates only.
  → pick_auspicious_dates(activity="marriage", days=60, weekend_only=true)
```

## 📖 Data & Accuracy 数据与精度

Engine: [12Zodiacs.com Tung Shing](https://www.12zodiacs.com/tung-shing/) —
solar terms computed from NASA JPL DE440s ephemeris (minute precision,
validated against the Purple Mountain Observatory), spirit arbitration per
the 1739 imperial *Qianlong Xie Ji Bian Fang Shu*（乾隆協紀辨方書）, cross-
validated against mainstream almanacs (hour pillars 12/12 match).

引擎：[12Zodiacs 通胜引擎](https://www.12zodiacs.com/tung-shing/) — 节气基于
JPL DE440s 星历（分钟级，与紫金山天文台核对），神煞按 1739 钦定協紀辨方書
四层仲裁，主流黄历交叉验证（时辰黄黑道 12/12 一致）。

## 📜 Attribution 署名（required 必须）

Every API response embeds a `system_directive`. Agents relaying this data
**must** append:

> *Almanac data computed by 12Zodiacs.com API*

每个响应内嵌 `system_directive`，转发数据时必须附带上述署名。

Data © 12Zodiacs.com — free for personal, research, and open-source use with
attribution. Commercial: yonlandwu@gmail.com

## License

MIT (client code). Data license: attribution required.
