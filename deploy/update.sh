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
tar -czf $BACKUP_FILE config.yml data/ 2>/dev/null
echo "✅ 备份已保存到: $BACKUP_FILE"

echo ""
echo "🔄 正在拉取最新镜像..."
docker compose pull

echo ""
echo "🔄 正在重启服务..."
docker compose up -d

echo ""
echo "🧹 正在清理旧镜像..."
docker image prune -f 2>/dev/null || true

echo ""
echo "=========================================="
echo "  ✅ NanoRoute 更新完成！"
echo "=========================================="
echo ""
echo "📊 服务状态:"
docker compose ps
echo ""
echo "📝 查看日志: cd $INSTALL_DIR && docker compose logs -f"
echo ""
