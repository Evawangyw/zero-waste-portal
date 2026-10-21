// 验收：抽取式回答贴原文、相近国标不因共有「实施」被写进来、问到某地时丢掉别的省市。
import { composeExtractiveAnswer, supplementOutlineHits } from './ask.extract.js'
import type { ExtractHit } from './ask.extract.js'

function check(name: string, ok: boolean, failed: { n: number }): void {
  if (!ok) failed.n += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

function hit(partial: Partial<ExtractHit> & Pick<ExtractHit, 'knowledgeId' | 'title' | 'content'>): ExtractHit {
  return {
    score: 0.5,
    customMetadataText: '',
    ...partial,
  }
}

function main(): void {
  const failed = { n: 0 }

  const dated = composeExtractiveAnswer('GB 45186—2024 哪天发布、哪天实施？', [
    hit({
      knowledgeId: 'express',
      title: 'GB 45186-2024 限制快递过度包装要求.pdf',
      score: 0.69,
      customMetadataText: '知识类型: 各类标准\n知识发布机构: 国家市场监督管理总局\n知识发布年份: 2024',
      content:
        '# 限制快递过度包装要求\n##### GB 45186—2024\n#### <u>2024-12-31发布 2026-07-01实施</u>\n参考文献 [1] GB/T 1.1\n适用于进入快递渠道的非循环类快递包装。不适用于信件。',
    }),
    hit({
      knowledgeId: 'food',
      title: 'GB 23350-2021 限制商品过度包装要求 食品和化妆品.pdf',
      score: 0.42,
      customMetadataText: '知识类型: 各类标准\n知识发布年份: 2021',
      content: '本修改单自 2022 年 8 月 15 日起实施。粮食及其加工品不应超过三层。',
    }),
  ])
  check('快递标准的发布日和实施日留在回答里', dated.answer.includes('2024-12-31') && dated.answer.includes('2026-07-01'), failed)
  check('标准编号那一行不单独当成答案', !dated.answer.startsWith('GB 45186'), failed)
  check('食品国标的实施日没有混进来', !dated.answer.includes('2022 年 8 月 15 日'), failed)
  check('来源第一篇是快递国标', dated.sources[0]?.docId === 'express', failed)
  check('来源里没有食品国标', dated.sources.every((source) => source.docId !== 'food'), failed)
  check('回答带来源标记', dated.answer.includes('@@sources@@'), failed)

  const geo = composeExtractiveAnswer('上海生活垃圾分类有什么要求？', [
    hit({
      knowledgeId: 'sh',
      title: '上海市生活垃圾管理条例',
      score: 0.4,
      customMetadataText: '知识类型: 政策法规\n知识发布机构: 上海市人大常委会\n知识发布年份: 2019',
      content: '上海市实行生活垃圾分类制度，单位和个人应当分类投放生活垃圾。',
    }),
    hit({
      knowledgeId: 'bj',
      title: '北京市生活垃圾管理条例',
      score: 0.8,
      customMetadataText: '知识类型: 政策法规',
      content: '北京市产生生活垃圾的单位和个人是生活垃圾分类投放的责任主体。',
    }),
  ])
  check('问上海时保留上海条例', geo.answer.includes('上海市实行生活垃圾分类制度'), failed)
  check('问上海时不写北京条例的句子', !geo.answer.includes('北京市产生生活垃圾'), failed)

  const vectorOnly = composeExtractiveAnswer('生产者责任延伸制度如何落实', [
    hit({
      knowledgeId: 'wet',
      title: '厨余垃圾投放指引',
      channel: 'vector',
      content: '湿垃圾应破袋后投入收集容器，日产日清。',
    }),
  ])
  check(
    '向量单独召回、字面不重合的原句仍留下',
    vectorOnly.answer.includes('湿垃圾应破袋后投入收集容器'),
    failed,
  )

  const tocQuery = '中华人民共和国生态环境法里面有哪些章节'
  const tocHead = hit({
    knowledgeId: 'code',
    title: '中华人民共和国生态环境法典',
    chunkId: 1,
    score: 0.2,
    customMetadataText: '知识类型: 政策法规',
    content:
      '## 中华人民共和国生态环境法典\n目录\n第一编 总则\n第一章 基本规定\n第二章 监督管理\n第一分编通则\n第三章 规划和生态环境分区管控',
  })
  const tocRest = hit({
    knowledgeId: 'code',
    title: '中华人民共和国生态环境法典',
    chunkId: 2,
    content:
      '第四章 标准和监测\n第五章 生态环境影响评价\n第六章 生态保护补偿\n第七章 突发生态环境事件应对\n第八章 保障措施\n第九章 信息公开与公众参与\n第二编 污染防治',
  })
  const tocTail = hit({
    knowledgeId: 'code',
    title: '中华人民共和国生态环境法典',
    chunkId: 3,
    content: '第三章 附则\n第一编 总则\n第一章 基本规定\n第一条 为了保护生态环境，制定本法。',
  })
  const otherCode = hit({
    knowledgeId: 'other',
    title: '生活垃圾分类条例',
    chunkId: 9,
    score: 0.9,
    content: '第一章 总则\n第二章 规划\n第三章 监督\n第四章 责任\n应当依法分类投放生活垃圾。',
  })
  const supplemented = supplementOutlineHits(tocQuery, [tocHead, otherCode], [tocHead, tocRest, tocTail])
  const chapters = composeExtractiveAnswer(tocQuery, supplemented)
  check('问章节时补上没被召回的后半目录', chapters.answer.includes('第九章 信息公开与公众参与'), failed)
  check('问章节时保留编名', chapters.answer.includes('第一编 总则') && chapters.answer.includes('第二编 污染防治'), failed)
  check('问章节时保留没有空格的分编', chapters.answer.includes('第一分编通则'), failed)
  check('问章节时保留紧贴条文之前的附则', chapters.answer.includes('第三章 附则'), failed)
  check('问章节时不把正文第一条写进目录', !chapters.answer.includes('制定本法'), failed)
  check('问章节时不混入另一部资料', !chapters.answer.includes('分类投放'), failed)
  check('问章节时用来源里的正式名称', chapters.answer.includes('生态环境法典'), failed)

  const untouched = supplementOutlineHits('今天天气怎么样', [tocHead], [tocHead, tocRest])
  check('不是问目录时不改写命中', untouched.length === 1 && untouched[0]?.content === tocHead.content, failed)

  const none = composeExtractiveAnswer('完全无关的问题', [])
  check('没有命中时说明库内没有依据', none.mode === 'empty' && none.answer.includes('未检索到'), failed)
  check('没有命中时不带来源标记', !none.answer.includes('@@sources@@'), failed)

  if (failed.n > 0) {
    console.error(`失败 ${failed.n} 项`)
    process.exit(1)
  }
  console.log('ask.extract 自测通过')
}

main()
