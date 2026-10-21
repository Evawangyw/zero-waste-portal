// 验收：无关问题不调用模型；模型没按资料引用时不附来源；按资料回答时保留 [[n]] 和 @@sources@@。
import { composeExtractiveAnswer } from './ask.extract.js'
import type { ExtractHit, ExtractiveSource } from './ask.extract.js'
import { buildChatMessages, collectGroundedAnswer, decideGrounding, readBailianLine } from './ask.generate.js'

function check(name: string, ok: boolean, failed: { n: number }): void {
  if (!ok) failed.n += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

function hit(partial: Partial<ExtractHit> & Pick<ExtractHit, 'knowledgeId' | 'title' | 'content'>): ExtractHit {
  return { score: 0.8, customMetadataText: '知识类型: 政策法规', ...partial }
}

async function* deltas(parts: readonly string[]): AsyncGenerator<string> {
  for (const part of parts) yield part
}

const source: ExtractiveSource = {
  index: 1,
  docId: 'sh',
  title: '上海市生活垃圾管理条例',
  organization: '上海市人大常委会',
  year: '2019',
  docType: '政策法规',
}

async function main(): Promise<void> {
  const failed = { n: 0 }

  const weather = decideGrounding(composeExtractiveAnswer('今天天气怎么样', []))
  check('天气问题没有命中时不生成', weather.action === 'refuse' && weather.notice.includes('未检索到'), failed)

  const composed = composeExtractiveAnswer('上海生活垃圾怎么分类？', [
    hit({
      knowledgeId: 'sh',
      title: '上海市生活垃圾管理条例',
      content: '上海市实行生活垃圾分类制度，单位和个人应当分类投放生活垃圾。',
    }),
  ])
  const grounded = decideGrounding(composed)
  check('抽出原文后才生成', grounded.action === 'generate', failed)
  if (grounded.action === 'generate') {
    check('送给模型的资料不含来源标记', !grounded.evidence.includes('@@sources@@'), failed)
    const messages = buildChatMessages('今天天气怎么样', grounded.evidence)
    const system = messages[0]?.content ?? ''
    const user = messages[1]?.content ?? ''
    check('系统提示要求答不了就说库内没有依据', system.includes('未检索到与该问题直接相关'), failed)
    check('系统提示禁止用资料以外的知识', system.includes('不要使用资料以外的知识'), failed)
    check('名称差几个字时仍按资料正式名称回答', system.includes('正式名称'), failed)
    check('用户消息带上问题和资料', user.includes('今天天气怎么样') && user.includes('生活垃圾分类'), failed)
    check('提示词里没有密钥', !system.includes('sk-') && !user.includes('sk-'), failed)
  }

  const refused = await collectGroundedAnswer(
    deltas(['当前知识库中未检索到与该问题直接相关的可靠依据，建议更换关键词或在知识库中按主题浏览。']),
    [source],
  )
  check('模型拒答时不附来源', refused.includes('未检索到') && !refused.includes('@@sources@@'), failed)

  const uncited = await collectGroundedAnswer(deltas(['今天上海多云，气温适宜。']), [source])
  check('没有引用资料的回答改成库内无依据', uncited.includes('未检索到') && !uncited.includes('多云'), failed)

  const cited = await collectGroundedAnswer(
    deltas(['上海市实行生活垃圾分类制度。 [[1]]']),
    [source],
  )
  check('按资料回答时保留引用', cited.includes('[[1]]') && cited.includes('@@sources@@'), failed)
  check('来源卡片指向原文档', cited.includes('"docId":"sh"'), failed)

  const chunk = readBailianLine('data: {"choices":[{"delta":{"content":"分类"}}]}')
  check('能读出流式增量', chunk === '分类', failed)
  check('能认出流结束', readBailianLine('data: [DONE]') === 'done', failed)

  let threw = false
  try {
    readBailianLine('data: {"error":{"message":"模型不可用"}}')
  } catch (err) {
    threw = err instanceof Error && err.message === '模型不可用'
  }
  check('上游错误不带密钥', threw, failed)

  if (failed.n > 0) {
    console.error(`FAIL ${failed.n}`)
    process.exit(1)
  }
  console.log('PASS ask.generate')
}

void main()
