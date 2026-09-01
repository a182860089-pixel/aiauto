# 卡密与一机一码授权服务端 (License Server)

这是一个完全独立的卡密授权服务端，专为桌面客户端（Electron / EXE）提供**一机一码绑定**、**有效期控制**与**卡密增删改查管理**。

---

## 🌟 功能特性

1. **一机一码精准绑定**：卡密首次激活时自动绑定用户电脑机器码，防止单张卡密被多台电脑共享滥用。
2. **灵活的时长配置**：支持设置小时、天数、月份、年份或永久授权，激活后才开始倒计时。
3. **Web 可视化管理后台**：
   - 访问 `http://服务器IP:3000/admin`
   - 看板数据统计（总数、待激活、使用中、已过期、已禁用）。
   - 批量一键生成卡密、前缀定制、备注标记。
   - 一键复制卡密、导出 TXT 文本。
   - 卡密增删改查：支持随时增加天数（+7天、+30天等）、启用/禁用、换绑解绑机器码。
4. **轻量无外部依赖**：基于 Node.js，数据采用原子性双重备份存储（无需额外安装 MySQL 或复杂的数据库软件，低配云服务器 1 核 512M 也能丝滑运行）。

---

## 🚀 部署指引（上传到云服务器）

### 方式 1：常规 Linux 服务器部署（推荐）

#### 1. 上传文件
将整个 `license-server` 文件夹上传到你的云服务器（例如 `/www/wwwroot/license-server` 或 `/root/license-server`）。

#### 2. 安装依赖并启动
```bash
cd /root/license-server
npm install --production

# 启动测试
node server.js
```

#### 3. 使用 PM2 守护进程（开机自启与后台运行）
```bash
# 全局安装 pm2（如果没有）
npm install -g pm2

# 启动并命名服务
pm2 start server.js --name "license-server"

# 保存守护进程
pm2 save
pm2 startup
```

---

### 方式 2：宝塔面板部署（小白最简）

1. 进入宝塔面板 -> **Node 项目** -> 添加 Node 项目。
2. 项目目录选择上传的 `license-server` 目录。
3. 启动文件选择 `server.js`。
4. 项目端口填写 `3000`。
5. 点击提交并安装依赖即可自动启动。

---

### 方式 3：Docker 部署

```bash
docker build -t license-server .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data --name license-server --restart always license-server
```

---

## ⚙️ 配置文件说明 (`config.json`)

```json
{
  "port": 3000,
  "adminPassword": "admin",
  "secretKey": "change_this_to_your_secure_random_key_7788",
  "appName": "病例自动传-卡密授权中心"
}
```

- `port`: 监听端口（默认 3000，请确保云服务器防火墙和安全组已放行对应端口）。
- `adminPassword`: Web 后台管理初始密码（可在网页端右上角随时修改）。
- `secretKey`: 签名加密密钥（建议上线前修改为自定义随机字符串）。

---

## 📡 核心 API 接口列表

| 接口 | 方法 | 说明 | 入参 |
| :--- | :--- | :--- | :--- |
| `/api/license/activate` | POST | 客户端激活卡密 | `{ code, machineId, clientInfo }` |
| `/api/license/verify` | POST | 客户端启动/心跳校验 | `{ machineId, token, code }` |
| `/api/license/ping` | GET | 检查服务器连通性 | 无 |
| `/api/admin/login` | POST | 管理员登录后台 | `{ password }` |
| `/api/admin/licenses` | GET | 查询/搜索卡密列表 | `keyword, status, page, pageSize` |
| `/api/admin/licenses/generate` | POST | 批量生成卡密 | `{ count, durationValue, durationType, prefix, note }` |
| `/api/admin/licenses/:id` | PUT | 修改卡密/延期/解绑 | `{ status, addDays, unbindMachine, note }` |
| `/api/admin/licenses/:id` | DELETE| 删除单张卡密 | 无 |
