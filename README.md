# 膳食日志及血糖测量表 PWA

这是一个可安装的 PWA 版本膳食和血糖记录工具，按纸质表单结构设计，分为三个视图：

- 首页：统计所有记录，展示总记录数、记录天数、平均血糖、异常次数、餐次分布和最近血糖
- 记录：记录当天日志，填写餐次、就餐时间、食物、血糖测量和运动时间
- 列表：查看全部记录，支持删除、清空，以及多选日期导出 Excel

## 使用方式

启动 Web 后端，后端会同时托管 PWA 静态文件和数据 API：

```powershell
cd D:\项目生产基地\food_records
npm start
```

然后打开： 

```text
http://127.0.0.1:5173
```

## Dokploy 部署

项目已经包含 `Dockerfile` 和 `docker-compose.yml`，适合在 Dokploy 中自动部署。

### 推荐：Docker Compose

在 Dokploy 中创建应用时选择 Docker Compose，仓库根目录使用本项目目录，Compose 文件使用：

```text
docker-compose.yml
```

服务默认监听：

```text
5173
```

需要持久化的数据目录：

```text
/app/data
```

`docker-compose.yml` 已配置命名卷 `food-records-data`，记录会保存到容器内 `/app/data/records.json`，重启后不会丢失。

### Dockerfile 部署

如果选择 Dockerfile 部署：

- Dockerfile：`Dockerfile`
- 容器端口：`5173`
- 环境变量：
  - `HOST=0.0.0.0`
  - `PORT=5173`
  - `APP_PASSWORD=250830`
  - `AUTH_SECRET=请设置为随机长字符串`
- 持久化目录：`/app/data`

健康检查接口：

```text
/api/health
```

如果 Dokploy 显示部署成功但浏览器仍是旧页面：

1. 打开 `/api/health`，确认返回的 `version` 是最新版本。
2. 在 Dokploy 中执行 Rebuild / Redeploy，并关闭构建缓存。
3. 浏览器清除该站点数据，或卸载后重新添加 PWA。
4. 确认 Dokploy 部署的分支是 `main`，并且拉到了最新提交。

如果 Dokploy 的“查看日志”报 `tail: cannot open ... No such file or directory`，这通常是 Dokploy 部署日志文件没有生成或已被清理，不一定是应用运行失败。可以在服务器上用容器日志排查：

```bash
docker ps -a
docker logs <container_id_or_name> --tail 100
```

使用 Docker Compose 部署时，也可以查看服务日志：

```bash
docker compose logs food-records --tail 100
```

## 功能

- 密码登录，默认密码：`250830`
- 首页统计所有记录
- 记录当天膳食、血糖和运动
- 查看记录列表
- 多选日期导出 Excel
- 浏览器本地离线缓存
- 支持添加到桌面/主屏幕
- Web 后端保存记录到 `data/records.json`

当前数据优先保存到本地 Web 后端的 `data/records.json`；如果后端不可用，前端会临时回退到浏览器本地存储。

## API

- `GET /api/health`：健康检查
- `GET /api/session`：查询登录状态
- `POST /api/login`：登录
- `POST /api/logout`：退出登录
- `GET /api/records`：读取全部记录
- `POST /api/records`：新增或覆盖一条记录
- `DELETE /api/records/:id`：删除单条记录
- `DELETE /api/records`：清空全部记录
