#!/bin/sh
# 同時啟動 nginx 和 Node.js proxy

# 啟動 Node.js proxy（背景執行）
node /app/server/index.js &

# 啟動 nginx（前景執行，作為主程序）
nginx -g 'daemon off;'
