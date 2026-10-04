// 临时探测：验证对接层直连 WeKnora 是否拿到数据（非仓库产物，用完删）
import { WeKnoraClient, loadEnvFile } from '../weknora/index.js'

async function main(): Promise<void> {
  loadEnvFile()
  const c = WeKnoraClient.fromEnv()
  console.log('baseUrl=', c.config.baseUrl, 'kb=', c.config.knowledgeBaseId)
  const r = await c.listKnowledge({ page: 1, pageSize: 3 })
  console.log('total=', r.total, 'items=', r.items.length, 'first=', r.items[0]?.title)
  const all = await c.listAllKnowledge()
  console.log('listAllKnowledge len=', all.length)
  const one = await c.getKnowledge(all[0]?.id ?? '')
  console.log('getKnowledge title=', one.title, 'meta=', JSON.stringify(one.customMetadata))
  const bin = await c.preview(all[0]?.id ?? '')
  console.log('preview ct=', bin.contentType, 'len=', bin.bytes.byteLength)
}

main().catch((e: unknown) => {
  console.error('ERR', e)
})
