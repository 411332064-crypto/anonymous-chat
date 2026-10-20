# Ranunculus Hall

不用登入的匿名聊天室。輸入一個代號就能進來聊天，不保留任何聊天紀錄。

- 網址：https://411332064-crypto.github.io/anonymous-chat/
- 目前進度：**階段二**（已接上 Supabase，可以和其他人即時聊天）

## 文件
- [需求說明](docs/requirements.md)
- [架構文件](docs/architecture.md)
- [畫面設計](docs/design.md)

## 在自己電腦上預覽
不用安裝任何東西，只要有 Python：

```
python -m http.server 8000
```

然後打開 http://localhost:8000/ 。

測試用的網址參數：
- `?mock=1`：切回模擬模式（不連 Supabase，其他人都是模擬的）；下面幾個參數要搭配它使用
- `?test=fail`：第一次連線會失敗，可以測「重試」
- `?test=disconnect`：進入 15 秒後斷線 10 秒
- `?bots=0`：不要模擬的使用者
