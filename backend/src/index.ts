// 零废弃知识库 · 自建后端入口（T00 空壳）
// 默认端口 4000，可用 PORT 覆盖。
import { createApp } from './app.js'
import { loadConfig } from './config/index.js'

const config = loadConfig()
const app = createApp()

app.listen(config.port, () => {
  console.log(
    `[zero-waste-backend] listening on http://localhost:${config.port} (env=${config.nodeEnv})`,
  )
})
