#!/bin/bash
set -e

echo "=========================================="
echo "  🚀 NanoRoute AI Gateway - 一键安装"
echo "=========================================="
echo ""

if [ "$EUID" -ne 0 ]; then 
  echo "请使用 root 用户运行: sudo bash install.sh"
  exit 1
fi

INSTALL_DIR="/opt/nanoroute"
PORT=30128
DEFAULT_PASS="123456"

if [ -n "$ADMIN_PASSWORD" ]; then
  ADMIN_PASS="$ADMIN_PASSWORD"
  echo "🔐 使用环境变量设置的密码"
else
  ADMIN_PASS="$DEFAULT_PASS"
  echo "🔐 使用默认密码: 123456"
  echo "   安装完成后请尽快在配置页面修改密码！"
fi
echo ""

if ! command -v docker &> /dev/null; then
  echo "📦 正在安装 Docker..."
  curl -fsSL https://get.docker.com | bash
  systemctl enable --now docker
  echo "✅ Docker 安装完成"
fi

if ! command -v docker compose &> /dev/null; then
  echo "📦 正在安装 Docker Compose..."
  apt install -y docker-compose-plugin 2>/dev/null || curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
fi

mkdir -p $INSTALL_DIR/data
cd $INSTALL_DIR

cat > docker-compose.yml << EOF
version: '3.8'

services:
  nanoroute:
    image: ghcr.io/energie2008/nanoroute:latest
    container_name: nanoroute
    restart: unless-stopped
    ports:
      - "${PORT}:30128"
    volumes:
      - ./config.yml:/app/config.yml
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - ADMIN_PASSWORD=${ADMIN_PASS}
      - PORT=30128
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:30128/healthz').catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    mem_limit: 256m
    memswap_limit: 256m
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF

if [ ! -f config.yml ]; then
  echo "⚙️  生成默认配置文件..."
  cat > config.yml << EOF
port: 30128
log_level: info

routing:
  default_strategy: round-robin
  sticky_limit: 1
  combo_sticky_limit: 1
  fallback_on: [429, 503, 504]

providers: []
provider_groups: []
combos: []
aliases: {}
EOF
fi

echo ""
echo "🐳 正在启动 NanoRoute..."
docker compose pull 2>/dev/null || echo "使用本地镜像"
docker compose up -d

echo ""
echo "=========================================="
echo "  ✅ NanoRoute 安装完成！"
echo "=========================================="
echo ""
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ip.sb 2>/dev/null || echo "你的服务器IP")
echo "📊 管理后台: http://${SERVER_IP}:${PORT}/"
echo "⚙️  配置页面: http://${SERVER_IP}:${PORT}/config"
echo "🔌 API地址:  http://${SERVER_IP}:${PORT}/v1"
echo ""
echo "⚠️  默认密码: 123456 (请登录后立即修改！)"
echo ""
echo "🔧 常用命令:"
echo "  查看日志: cd ${INSTALL_DIR} && docker compose logs -f"
echo "  重启服务: cd ${INSTALL_DIR} && docker compose restart"
echo "  停止服务: cd ${INSTALL_DIR} && docker compose down"
echo "  备份配置: bash <(curl -fsSL https://raw.githubusercontent.com/energie2008/NanoRoute/main/deploy/backup.sh)"
echo "  卸载服务: bash <(curl -fsSL https://raw.githubusercontent.com/energie2008/NanoRoute/main/deploy/uninstall.sh)"
echo ""
