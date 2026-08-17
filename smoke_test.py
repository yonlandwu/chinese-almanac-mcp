#!/usr/bin/env python3
"""MCP 协议级烟测: spawn dist/index.js, 发 5 个 JSON-RPC 调用, 断言响应."""
import json, subprocess, sys, os

NODE = "/Users/YL/.workbuddy/binaries/node/versions/20.18.0/bin/node"
CWD = "/Users/YL/WorkBuddy/2026-08-15-01-48-09/chinese-almanac-mcp"

env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
proc = subprocess.Popen([NODE, "dist/index.js"], cwd=CWD, env=env,
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)

reqs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "smoke", "version": "1.0"}}},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_daily_almanac", "arguments": {"date": "2026-08-18"}}},
    {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {"name": "pick_auspicious_dates", "arguments": {"activity": "marriage", "weekend_only": True}}},
    {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {"name": "get_personal_lucky_hours", "arguments": {"zodiac": "horse", "date": "2026-08-22"}}},
    {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {"name": "list_activities", "arguments": {}}},
]
for r in reqs:
    proc.stdin.write(json.dumps(r) + "\n")
proc.stdin.close()

results = {}
for _ in range(len(reqs)):
    line = proc.stdout.readline()
    if not line:
        break
    try:
        d = json.loads(line)
    except Exception:
        continue
    if "id" in d:
        results[d["id"]] = d
proc.wait(timeout=10)

ok = 0
r1 = results.get(1, {}).get("result", {}).get("serverInfo", {})
print("✓ initialize" if r1.get("name") == "chinese-almanac-mcp" else f"✗ init {r1}", "|", r1.get("version"))
ok += 1 if r1.get("name") == "chinese-almanac-mcp" else 0

tools = results.get(2, {}).get("result", {}).get("tools", [])
names = [t["name"] for t in tools]
print(f"✓ tools/list: {len(tools)} tools" if len(tools) == 7 else f"✗ tools {len(tools)}")
print("   ", ", ".join(names))
ok += 1 if len(tools) == 7 else 0

t3 = json.loads(results.get(3, {}).get("result", {}).get("content", [{}])[0].get("text", "{}"))
zhi = t3.get("day_officer_zhi_shen", {}).get("cn")
clash = t3.get("clash", {}).get("animal")
print(f"✓ daily_almanac 08-18: 值神{zhi} 冲{clash}" if zhi else "✗ almanac empty")
ok += 1 if zhi else 0

t4 = json.loads(results.get(4, {}).get("result", {}).get("content", [{}])[0].get("text", "{}"))
n4 = len(t4.get("recommended_dates", []))
print(f"✓ auspicious(marriage,weekend): {t4.get('activity')} {n4}推荐 weekend={t4.get('weekend_only')}" if n4 else "✗ auspicious empty")
ok += 1 if n4 else 0

t5 = json.loads(results.get(5, {}).get("result", {}).get("content", [{}])[0].get("text", "{}"))
bh = t5.get("best_hours", [{}])
print(f"✓ lucky_hours(horse): {bh[0].get('branch')} {bh[0].get('relation')}" if bh and bh[0] else "✗ lucky hours empty")
ok += 1 if bh and bh[0].get("branch") else 0

t6 = json.loads(results.get(6, {}).get("result", {}).get("content", [{}])[0].get("text", "{}"))
acts = t6.get("activities", [])
print(f"✓ list_activities: {len(acts)} activities" if len(acts) == 8 else f"✗ activities {len(acts)}")
ok += 1 if len(acts) == 8 else 0

print(f"\n=== SMOKE: {ok}/6 PASS ===")
sys.exit(0 if ok == 6 else 1)
