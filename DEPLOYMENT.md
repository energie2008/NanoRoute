# NanoRoute 部署指南

## 本地开发环境

### 要求
- Node.js >= 22.0.0
- 8MB 磁盘空间
- Windows/Linux/macOS

### 快速开始

```bash
# 1. 进入项目目录
cd NanoRoute

# 2. 安装依赖
npm install

# 3. 配置
cp config.example.yml config.yml
# 编辑 config.yml，填入你的 API Keys

# 4. 启动
node server.js
```

### 验证安装

```bash
# 检查健康状态
curl http://localhost:20128/api/health

# 访问 Dashboard
# 打开浏览器：http://localhost:20128
```

## VPS 部署

### 方式 1：直接部署

```bash
# 1. 安装 Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 克隆/上传项目
cd /opt
git clone <your-repo> nanoroute
cd nanoroute

# 3. 安装依赖
npm install --production

# 4. 配置
cp config.example.yml config.yml
nano config.yml  # 编辑配置

# 5. 测试启动
node server.js

# 6. 使用 PM2 持久化
npm install -g pm2
pm2 start server.js --name nanoroute
pm2 save
pm2 startup  # 开机自启
```

### 方式 2：systemd 服务

创建 `/etc/systemd/system/nanoroute.service`:

```ini
[Unit]
Description=NanoRoute AI Gateway
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/nanoroute
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=10
StandardOutput=append:/var/log/nanoroute/output.log
StandardError=append:/var/log/nanoroute/error.log

Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

启动服务：

```bash
# 创建日志目录
sudo mkdir -p /var/log/nanoroute
sudo chown www-data:www-data /var/log/nanoroute

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable nanoroute
sudo systemctl start nanoroute

# 查看状态
sudo systemctl status nanoroute

# 查看日志
sudo journalctl -u nanoroute -f
```

### 方式 3：Docker 部署

```bash
# 1. 构建镜像
docker build -t nanoroute:latest .

# 2. 创建配置和数据目录
mkdir -p ~/nanoroute/{config,data}
cp config.example.yml ~/nanoroute/config/config.yml
nano ~/nanoroute/config/config.yml

# 3. 运行容器
docker run -d \
  --name nanoroute \
  --restart unless-stopped \
  -p 20128:20128 \
  -v ~/nanoroute/config/config.yml:/app/config.yml:ro \
  -v ~/nanoroute/data:/app/data \
  -m 256m \
  nanoroute:latest

# 4. 查看日志
docker logs -f nanoroute

# 5. 重启
docker restart nanoroute
```

### 方式 4：Docker Compose

创建 `docker-compose.yml`:

```yaml
version: '3.8'

services:
  nanoroute:
    build: .
    container_name: nanoroute
    restart: unless-stopped
    ports:
      - "20128:20128"
    volumes:
      - ./config.yml:/app/config.yml:ro
      - ./data:/app/data
    mem_limit: 256m
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

运行：

```bash
# 启动
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止
docker-compose down

# 更新
docker-compose pull
docker-compose up -d
```

## 反向代理配置

### Nginx

```nginx
# /etc/nginx/sites-available/nanoroute

upstream nanoroute {
    server 127.0.0.1:20128;
}

server {
    listen 80;
    server_name ai.yourdomain.com;

    # 可选：添加基础认证
    # auth_basic "Restricted";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://nanoroute;
        proxy_http_version 1.1;
        
        # SSE 支持
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        
        # 通用代理头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 300s;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/nanoroute /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Caddy

```caddy
# Caddyfile

ai.yourdomain.com {
    reverse_proxy localhost:20128 {
        flush_interval -1
    }
    
    # 可选：基础认证
    # basicauth {
    #     admin $2a$14$...
    # }
}
```

启动：

```bash
caddy run --config Caddyfile
```

## SSL/TLS 配置

### Let's Encrypt (Certbot)

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d ai.yourdomain.com

# 自动续期
sudo certbot renew --dry-run
```

### Caddy（自动 SSL）

```caddy
ai.yourdomain.com {
    reverse_proxy localhost:20128
    # Caddy 自动申请和续期 SSL 证书
}
```

## 监控与维护

### 健康检查

```bash
# 手动检查
curl http://localhost:20128/api/health

# 定时检查脚本
cat > /opt/nanoroute/healthcheck.sh << 'EOF'
#!/bin/bash
if ! curl -sf http://localhost:20128/api/health > /dev/null; then
    echo "[$(date)] NanoRoute health check failed"
    # 可选：重启服务
    # systemctl restart nanoroute
fi
EOF

chmod +x /opt/nanoroute/healthcheck.sh

# 添加到 crontab（每分钟检查）
echo "* * * * * /opt/nanoroute/healthcheck.sh >> /var/log/nanoroute/health.log 2>&1" | crontab -
```

### 日志管理

```bash
# logrotate 配置
cat > /etc/logrotate.d/nanoroute << 'EOF'
/var/log/nanoroute/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
}
EOF
```

### 性能监控

使用 Prometheus + Grafana：

```bash
# 暴露 metrics 端点（未来版本）
# GET /api/metrics
```

临时方案：

```bash
# 监控内存
watch -n 5 'curl -s http://localhost:20128/api/health | jq .memory'

# 监控请求统计
watch -n 5 'curl -s http://localhost:20128/api/stats'
```

## 备份与恢复

### 备份

```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="/backup/nanoroute"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# 备份配置
cp /opt/nanoroute/config.yml $BACKUP_DIR/config_$DATE.yml

# 备份数据
cp -r /opt/nanoroute/data $BACKUP_DIR/data_$DATE

# 压缩
tar -czf $BACKUP_DIR/nanoroute_$DATE.tar.gz \
    $BACKUP_DIR/config_$DATE.yml \
    $BACKUP_DIR/data_$DATE

# 清理
rm -rf $BACKUP_DIR/config_$DATE.yml $BACKUP_DIR/data_$DATE

# 保留最近 7 天
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: nanoroute_$DATE.tar.gz"
```

定时备份：

```bash
# 每天凌晨 2 点备份
echo "0 2 * * * /opt/nanoroute/backup.sh" | crontab -
```

### 恢复

```bash
# 解压备份
tar -xzf /backup/nanoroute/nanoroute_20260627_020000.tar.gz -C /tmp

# 恢复配置
cp /tmp/config_*.yml /opt/nanoroute/config.yml

# 恢复数据
cp -r /tmp/data_* /opt/nanoroute/data

# 重启服务
systemctl restart nanoroute
```

## 更新升级

### 手动更新

```bash
# 1. 备份
./backup.sh

# 2. 拉取新代码
cd /opt/nanoroute
git pull

# 3. 更新依赖
npm install --production

# 4. 重启服务
systemctl restart nanoroute

# 5. 验证
curl http://localhost:20128/api/health
```

### 零停机更新

```bash
# 使用 PM2
pm2 reload nanoroute

# 或使用蓝绿部署
# 启动新实例在不同端口
# 切换 Nginx upstream
# 停止旧实例
```

## 安全加固

### 1. 防火墙

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# NanoRoute 仅监听本地
# 通过 Nginx 反向代理对外
```

### 2. 限制访问

```nginx
# Nginx 配置
location / {
    # 限制 IP
    allow 192.168.1.0/24;
    deny all;
    
    # 或使用认证
    auth_basic "Restricted";
    auth_basic_user_file /etc/nginx/.htpasswd;
    
    proxy_pass http://nanoroute;
}
```

### 3. 速率限制

```nginx
# Nginx 全局限制
limit_req_zone $binary_remote_addr zone=nanoroute:10m rate=10r/s;

server {
    location / {
        limit_req zone=nanoroute burst=20 nodelay;
        proxy_pass http://nanoroute;
    }
}
```

### 4. 配置文件权限

```bash
# 限制配置文件访问
chmod 600 /opt/nanoroute/config.yml
chown www-data:www-data /opt/nanoroute/config.yml

# 限制数据目录
chmod 700 /opt/nanoroute/data
chown www-data:www-data /opt/nanoroute/data
```

## 故障排查

### 服务无法启动

```bash
# 查看日志
journalctl -u nanoroute -n 50

# 检查配置
node -e "const yaml = require('js-yaml'); const fs = require('fs'); console.log(yaml.load(fs.readFileSync('./config.yml', 'utf8')))"

# 检查端口占用
netstat -tlnp | grep 20128
```

### 内存占用过高

```bash
# 查看当前内存
curl http://localhost:20128/api/health | jq .memory

# 重启服务
systemctl restart nanoroute

# 考虑增加服务器内存或降低并发
```

### API 响应慢

```bash
# 查看上游 Provider 延迟
curl http://localhost:20128/api/stats | jq

# 检查网络
ping generativelanguage.googleapis.com

# 调整超时设置（nginx）
proxy_read_timeout 300s;
```

### 频繁切换 Provider

```bash
# 检查速率限制配置
curl http://localhost:20128/api/providers | jq

# 调整 sticky_limit
# 编辑 config.yml
routing:
  sticky_limit: 3  # 增加粘性
```

## 性能优化

### 系统优化

```bash
# 增加文件描述符限制
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# 调整 TCP 参数
cat >> /etc/sysctl.conf << EOF
net.ipv4.tcp_fin_timeout = 30
net.ipv4.tcp_tw_reuse = 1
net.core.somaxconn = 1024
EOF

sysctl -p
```

### Node.js 优化

```bash
# 增加最大内存（如果需要）
NODE_OPTIONS="--max-old-space-size=256" node server.js
```

## 生产环境检查清单

- [ ] 配置文件安全存储
- [ ] API Key 不在代码仓库中
- [ ] 配置了反向代理
- [ ] 启用了 SSL/TLS
- [ ] 配置了访问控制（IP 白名单或认证）
- [ ] 配置了速率限制
- [ ] 服务自动重启（PM2 或 systemd）
- [ ] 配置了日志轮转
- [ ] 配置了定时备份
- [ ] 配置了健康检查
- [ ] 配置了监控告警
- [ ] 测试了故障恢复流程

## 常用命令

```bash
# 查看服务状态
systemctl status nanoroute

# 查看实时日志
journalctl -u nanoroute -f

# 重启服务
systemctl restart nanoroute

# 查看内存使用
curl http://localhost:20128/api/health | jq .memory

# 查看 Provider 状态
curl http://localhost:20128/api/providers | jq

# 查看统计
curl http://localhost:20128/api/stats | jq

# 备份
./backup.sh

# 测试配置
node -c server.js
```

---

**部署支持**: 如有问题，请提交 Issue  
**文档更新**: 2026-06-27
