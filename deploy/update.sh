#!/bin/bash
set -e

echo "=========================================="
echo "  🔄 NanoRoute - 一键更新"
echo "=========================================="
echo ""

if [ "$EUID" -ne 0 ]; then 
  echo "请使用 root 用户运行: sudo bash update.sh"
  exit 1
fi

INSTALL_DIR="/opt/nanoroute"
REPO_URL="https://github.com/energie2008/NanoRoute.git"
BUILD_DIR="/tmp/nanoroute-latest"

if [ ! -d "$INSTALL_DIR" ]; then
  echo "❌ 未找到 NanoRoute 安装目录: $INSTALL_DIR"
  echo "   请先运行安装脚本:"
  echo "   bash <(curl -fsSL https://raw.githubusercontent.com/energie2008/NanoRoute/main/deploy/install.sh)"
  exit 1
fi

echo "💾 正在自动备份当前配置..."
BACKUP_DIR="/root/nanoroute-backups"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nanoroute-preupdate-$TIMESTAMP.tar.gz"
cd $INSTALL_DIR
cp docker-compose.yml docker-compose.yml.bak.$TIMESTAMP
tar -czf $BACKUP_FILE config.yml data/ docker-compose.yml 2>/dev/null
echo "✅ 备份已保存到: $BACKUP_FILE"

echo ""
echo "🔑 保存现有环境配置..."
OLD_ADMIN_PASS=$(grep ADMIN_PASSWORD docker-compose.yml | cut -d= -f2)
if [ -z "$OLD_ADMIN_PASS" ]; then
  OLD_ADMIN_PASS="123456"
fi

echo ""
echo "📥 正在拉取最新源代码..."
rm -rf $BUILD_DIR
git clone --depth 1 $REPO_URL $BUILD_DIR
cd $BUILD_DIR

echo ""
echo "🐳 正在构建最新Docker镜像（约2-3分钟）..."
docker build -t ghcr.io/energie2008/nanoroute:latest .

echo ""
echo "🔄 正在更新配置并重启服务..."
cd $INSTALL_DIR

cat > docker-compose.yml << EOF
version: '3.8'

services:
  nanoroute:
    image: ghcr.io/energie2008/nanoroute:latest
    container_name: nanoroute
    restart: unless-stopped
    ports:
      - "30128:30128"
    volumes:
      - ./config.yml:/app/config.yml
      - ./data:/app/data
    environment:
      - NODE_ENV=production
      - ADMIN_PASSWORD=${OLD_ADMIN_PASS}
      - API_KEYS=\${API_KEYS:-}
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

docker compose up -d

echo ""
echo "⏳ 等待服务启动..."
sleep 15

echo ""
echo "🧹 正在清理临时文件和旧镜像..."
rm -rf $BUILD_DIR
docker image prune -f 2>/dev/null || true

echo ""
echo "🏥 健康检查:"
curl -s http://127.0.0.1:30128/healthz
echo ""

echo ""
echo "=========================================="
echo "  ✅ NanoRoute 更新完成！"
echo "=========================================="
echo ""
echo "🌐 访问地址: https://ai.tiktokplay.na.am"
echo "🔑 管理密码: 已保留原有密码"
echo ""
echo "📊 服务状态:"
docker compose ps
echo ""
echo "📝 查看日志: cd $INSTALL_DIR && docker compose logs -f"
echo ""
