#!/bin/bash
set -e

echo "=========================================="
echo "  🗑️  NanoRoute - 一键卸载"
echo "=========================================="
echo ""

if [ "$EUID" -ne 0 ]; then 
  echo "请使用 root 用户运行: sudo bash uninstall.sh"
  exit 1
fi

INSTALL_DIR="/opt/nanoroute"
BACKUP_DIR="/root/nanoroute-backup-$(date +%Y%m%d-%H%M%S)"

if [ ! -d "$INSTALL_DIR" ]; then
  echo "❌ 未找到 NanoRoute 安装目录: $INSTALL_DIR"
  exit 1
fi

echo "⚠️  即将卸载 NanoRoute，这将:"
echo "   1. 停止并删除容器"
echo "   2. 备份配置到 $BACKUP_DIR"
echo "   3. 删除安装目录"
echo ""
read -p "是否继续? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "已取消卸载"
  exit 0
fi

echo ""
echo "📦 正在备份配置..."
mkdir -p $BACKUP_DIR
cp -r $INSTALL_DIR/config.yml $INSTALL_DIR/data $BACKUP_DIR/ 2>/dev/null || true
echo "✅ 配置已备份到: $BACKUP_DIR"

echo ""
echo "🐳 正在停止容器..."
cd $INSTALL_DIR
docker compose down 2>/dev/null || true
docker rm -f nanoroute 2>/dev/null || true

echo ""
echo "🗑️  正在删除安装目录..."
rm -rf $INSTALL_DIR

echo ""
echo "=========================================="
echo "  ✅ NanoRoute 已卸载完成！"
echo "=========================================="
echo ""
echo "💾 配置备份保存在: $BACKUP_DIR"
echo ""
