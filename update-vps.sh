#!/usr/bin/env bash
# ============================================================================
# NanoRoute (CLIProxyAPI Go 版) VPS 一键更新脚本
#
# 用法:
#   1. 上传本脚本到 VPS (或用 curl/wget 下载)
#   2. 以 root 或有 docker 权限的用户执行:
#        bash update-vps.sh
#
# 自定义变量 (可选, 用环境变量覆盖):
#   INSTALL_DIR=/opt/nanoroute bash update-vps.sh
#   REPO_URL=... BRANCH=main bash update-vps.sh
# ============================================================================

set -euo pipefail

# ============ 可配置变量 ============
INSTALL_DIR="${INSTALL_DIR:-/opt/nanoroute}"                       # 安装目录
REPO_URL="${REPO_URL:-https://github.com/energie2008/NanoRoute.git}"
BRANCH="${BRANCH:-main}"
OLD_CONTAINER="${OLD_CONTAINER:-nanoroute}"                        # 旧 Node.js 容器名
NEW_CONTAINER="${NEW_CONTAINER:-cli-proxy-api}"                    # 新 Go 容器名
# ====================================

# 颜色输出
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${BLUE}[$(date +%H:%M:%S)]${NC} $*"; }
ok()   { echo -e "${GREEN}[$(date +%H:%M:%S)] ✓${NC} $*"; }
warn() { echo -e "${YELLOW}[$(date +%H:%M:%S)] !${NC} $*"; }
err()  { echo -e "${RED}[$(date +%H:%M:%S) ✗${NC} $*"; }

echo -e "${BLUE}===========================================${NC}"
echo -e "${BLUE} NanoRoute (CLIProxyAPI Go) VPS 一键更新${NC}"
echo -e "${BLUE}===========================================${NC}"
echo "安装目录 : $INSTALL_DIR"
echo "仓库     : $REPO_URL ($BRANCH)"
echo "旧容器   : $OLD_CONTAINER (Node.js, 端口 30128)"
echo "新容器   : $NEW_CONTAINER (Go, 宿主机端口 40080 -> 容器 8317)"
echo ""

# 前置检查
command -v git >/dev/null 2>&1 || { err "未安装 git"; exit 1; }
command -v docker >/dev/null 2>&1 || { err "未安装 docker"; exit 1; }
docker compose version >/dev/null 2>&1 || { err "未安装 docker compose v2"; exit 1; }

# ----------------------------------------------------------------------------
# 1. 停止并移除旧的 Node.js NanoRoute 容器
# ----------------------------------------------------------------------------
log "[1/7] 处理旧的 Node.js NanoRoute 容器..."
if docker ps -a --format '{{.Names}}' | grep -qw "^${OLD_CONTAINER}$"; then
    docker stop "$OLD_CONTAINER" 2>/dev/null || true
    docker rm "$OLD_CONTAINER" 2>/dev/null || true
    ok "旧容器 $OLD_CONTAINER 已停止并移除"
else
    warn "未找到旧容器 $OLD_CONTAINER, 跳过"
fi

# 同时清理可能的旧镜像 (可选, 释放空间)
if docker images --format '{{.Repository}}:{{.Tag}}' | grep -qw "^nanoroute:latest$"; then
    docker rmi nanoroute:latest 2>/dev/null || true
    ok "旧镜像 nanoroute:latest 已清理"
fi

# ----------------------------------------------------------------------------
# 2. 准备安装目录
# ----------------------------------------------------------------------------
log "[2/7] 准备安装目录 $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

# ----------------------------------------------------------------------------
# 3. 拉取最新代码
# ----------------------------------------------------------------------------
log "[3/7] 拉取最新代码..."
if [ -d "$INSTALL_DIR/.git" ]; then
    git fetch --all --prune
    git reset --hard "origin/$BRANCH"
    git clean -fd
    ok "已更新到最新 ($BRANCH)"
else
    git clone -b "$BRANCH" "$REPO_URL" .
    ok "已克隆仓库 ($BRANCH)"
fi
log "当前提交: $(git log --oneline -1)"

# ----------------------------------------------------------------------------
# 4. 准备配置文件和目录
# ----------------------------------------------------------------------------
log "[4/7] 准备配置文件和挂载目录..."
mkdir -p auths logs

if [ ! -f config.yaml ]; then
    if [ -f config.example.yaml ]; then
        cp config.example.yaml config.yaml
        warn "已从 config.example.yaml 创建 config.yaml"
        warn "请编辑 config.yaml 填入你的 api-keys 和 provider 配置!"
    else
        err "未找到 config.example.yaml, 请手动创建 config.yaml"
        exit 1
    fi
else
    ok "config.yaml 已存在, 保留现有配置"
fi

# ----------------------------------------------------------------------------
# 5. 拉取最新镜像
# ----------------------------------------------------------------------------
log "[5/7] 拉取最新镜像 eceasy/cli-proxy-api:latest ..."
docker compose --pull always pull
ok "镜像拉取完成"

# ----------------------------------------------------------------------------
# 6. 启动新容器
# ----------------------------------------------------------------------------
log "[6/7] 启动新容器 $NEW_CONTAINER ..."
# 清理可能存在的同名旧容器 (兼容重复执行)
if docker ps -a --format '{{.Names}}' | grep -qw "^${NEW_CONTAINER}$"; then
    docker rm -f "$NEW_CONTAINER" 2>/dev/null || true
fi
docker compose up -d --remove-orphans
ok "容器已启动"

# ----------------------------------------------------------------------------
# 7. 验证启动
# ----------------------------------------------------------------------------
log "[7/7] 验证启动状态..."
sleep 4

if docker ps --format '{{.Names}}' | grep -qw "^${NEW_CONTAINER}$"; then
    HEALTHY=""
    for i in 1 2 3 4 5; do
        if curl -sf -o /dev/null --max-time 3 "http://127.0.0.1:40080/v1/models" 2>/dev/null; then
            HEALTHY="yes"
            break
        fi
        sleep 2
    done

    echo ""
    echo -e "${GREEN}===========================================${NC}"
    echo -e "${GREEN} 部署成功!${NC}"
    echo -e "${GREEN}===========================================${NC}"
    echo "容器名     : $NEW_CONTAINER"
    echo "API 端口   : 40080 (宿主机) -> 8317 (容器内, OpenAI/Gemini/Claude/Codex 兼容)"
    echo "             8085 / 1455 / 54545 / 51121 / 11451 (其他端口)"
    if [ -n "$HEALTHY" ]; then
        ok "健康检查通过 (/v1/models 可访问)"
    else
        warn "健康检查未通过, 可能需要配置 api-keys, 请查看日志"
    fi
    echo ""
    echo "常用命令:"
    echo "  查看日志 : docker compose -f $INSTALL_DIR/docker-compose.yml logs -f"
    echo "  重启服务 : docker compose -f $INSTALL_DIR/docker-compose.yml restart"
    echo "  停止服务 : docker compose -f $INSTALL_DIR/docker-compose.yml down"
    echo "  编辑配置 : vi $INSTALL_DIR/config.yaml"
    echo "  进入容器 : docker exec -it $NEW_CONTAINER bash"
    echo ""
    echo "首次使用:"
    echo "  1. 编辑 $INSTALL_DIR/config.yaml 填入 api-keys"
    echo "  2. docker compose restart"
    echo "  3. 将 OAuth 凭据放入 $INSTALL_DIR/auths/ (如需 Claude/Codex OAuth)"
    echo ""
    IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    [ -n "$IP" ] && echo "访问地址 : http://$IP:40080"
    echo -e "${GREEN}===========================================${NC}"
else
    err "容器启动失败, 最近日志:"
    docker compose logs --tail=30
    exit 1
fi
