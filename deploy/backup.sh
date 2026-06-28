#!/bin/bash
set -e

echo "=========================================="
echo "  💾 NanoRoute - 一键备份"
echo "=========================================="
echo ""

if [ "$EUID" -ne 0 ]; then 
  echo "请使用 root 用户运行: sudo bash backup.sh"
  exit 1
fi

INSTALL_DIR="/opt/nanoroute"
BACKUP_DIR="/root/nanoroute-backups"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="$BACKUP_DIR/nanoroute-backup-$TIMESTAMP.tar.gz"

if [ ! -d "$INSTALL_DIR" ]; then
  echo "❌ 未找到 NanoRoute 安装目录: $INSTALL_DIR"
  exit 1
fi

mkdir -p $BACKUP_DIR

echo "📦 正在备份配置和数据..."
cd $INSTALL_DIR
tar -czf $BACKUP_FILE config.yml data/ 2>/dev/null

FILESIZE=$(du -h $BACKUP_FILE | cut -f1)

echo ""
echo "=========================================="
echo "  ✅ 备份完成！"
echo "=========================================="
echo ""
echo "📄 备份文件: $BACKUP_FILE"
echo "📦 文件大小: $FILESIZE"
echo ""
echo "🔧 恢复命令:"
echo "   cd $INSTALL_DIR && docker compose down"
echo "   tar -xzf $BACKUP_FILE -C $INSTALL_DIR"
echo "   docker compose up -d"
echo ""
echo "📋 现有备份列表:"
ls -lh $BACKUP_DIR/ | tail -n +2
echo ""
