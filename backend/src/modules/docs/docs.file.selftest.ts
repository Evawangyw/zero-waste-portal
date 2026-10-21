// 模块边界：docs（文件层 · 自测）
// 契约（模块内）：文件名重命名 + 元数据容错 + 预览阈值分支 + DownloadLog 落库
// 用法：npx tsx src/modules/docs/docs.file.selftest.ts
//
// 验收④ 要求「不必真找 20MB 文件，用自测脚本证明分支可达」，故 decidePreview
// 在这里被直接喂假尺寸穷举分支（unsupported / tooLarge / 可流式三态）。
// 元数据容错同理：42 条实测只有 1 条填过，其余 41 条是 {} 或 null，
// 这里用空/脏样本证明不抛错。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnvFile } from '../../weknora/index.js'
import { getPrisma } from '../../db/prisma.js'
import {
  buildContentDisposition,
  buildDownloadFileName,
  isMetadataComplete,
  parseFileMetadata,
  resolveExtension,
  toMetadataView,
} from './docs.file.name.js'
import {
  decidePreview,
  isPreviewableExtension,
  loadPreviewMaxBytes,
  resolveDocDetail,
  writeDownloadLog,
} from './docs.file.service.js'
import { META_MISSING } from './docs.file.types.js'
import {
  buildNamedPreviewUrl,
  issuePreviewTicket,
  previewLeafName,
  verifyPreviewTicket,
} from './docs.preview.ticket.js'
import { parseSingleByteRange } from './docs.file.router.js'

let passed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failures.push(`${name}${detail === '' ? '' : ` —— ${detail}`}`)
    console.log(`  FAIL  ${name}${detail === '' ? '' : `  (${detail})`}`)
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  check(name, a === b, `实际 ${a}，期望 ${b}`)
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

/** 读同目录源码文本（架构断言用，避免 require 动态引入） */
function readSource(fileName: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, fileName), 'utf8')
}

// ================================================================ 1. custom_metadata 容错
function testMetadataTolerance(): void {
  section('1. custom_metadata 中文键解析 · 空值/脏值容错（42 条里只有 1 条填过）')

  eq('null -> 全空', parseFileMetadata(null), { year: '', org: '', docType: '', topics: [] })
  eq('undefined -> 全空', parseFileMetadata(undefined), {
    year: '',
    org: '',
    docType: '',
    topics: [],
  })
  eq('42 条里的典型空对象 {} -> 全空（不抛）', parseFileMetadata({}), {
    year: '',
    org: '',
    docType: '',
    topics: [],
  })
  eq(
    '键存在但值为 null -> 该维度空，其余照常',
    parseFileMetadata({ 年份: null, 知识发布机构: '生态环境局', 知识类型: '政策' }),
    { year: '', org: '生态环境局', docType: '政策', topics: [] },
  )
  eq('值为纯空白/全角空格 -> 当空处理', parseFileMetadata({ 年份: '　 \t ', 知识领域: '   ' }), {
    year: '',
    org: '',
    docType: '',
    topics: [],
  })
  eq('数字年份 2024 -> 字符串 "2024"', parseFileMetadata({ 年份: 2024 }).year, '2024')
  eq(
    '嵌套对象/数组/布尔 -> 当空处理（不炸）',
    parseFileMetadata({ 年份: { a: 1 }, 知识类型: ['x'], 知识发布机构: true }),
    { year: '', org: '', docType: '', topics: [] },
  )
  eq(
    '非对象（数组/字符串/数字）-> 全空',
    parseFileMetadata([] as unknown as Record<string, unknown>).year,
    '',
  )

  // 实测那条真填了的（元数据来自主控 T01 实测回显）
  const real = parseFileMetadata({
    年份: '2026',
    知识类型: '测试',
    知识领域: '测试领域',
    知识发布机构: '测试机构',
  })
  eq('真实四维（唯一填过的那条）', real, {
    year: '2026',
    org: '测试机构',
    docType: '测试',
    topics: ['测试领域'],
  })
  check('完整标注 -> metadataComplete=true', isMetadataComplete(real))
  check('空标注 -> metadataComplete=false', !isMetadataComplete(parseFileMetadata({})))

  eq('展示视图把空值归一为 未标注', toMetadataView(parseFileMetadata({})), {
    year: META_MISSING,
    org: META_MISSING,
    docType: META_MISSING,
    topics: [],
  })
  eq(
    '领域多值拆分 + 去重保序',
    parseFileMetadata({ 知识领域: '塑料污染，食物浪费; 塑料污染 / 海洋垃圾' }).topics,
    ['塑料污染', '食物浪费', '海洋垃圾'],
  )
  eq('领域本身是数组也吃', parseFileMetadata({ 知识领域: ['塑料污染', '食物浪费'] }).topics, [
    '塑料污染',
    '食物浪费',
  ])
}

// ================================================================ 2. 文件名重命名
function testDownloadFileName(): void {
  section('2. 下载文件名重命名「年份-机构-标题.ext」（缺段跳过 + 非法字符处理）')

  eq(
    '四段齐全 -> 年份-机构-标题.ext',
    buildDownloadFileName('2024', '生态环境局', '生活垃圾分类工作方案', 'pdf'),
    '2024-生态环境局-生活垃圾分类工作方案.pdf',
  )
  eq(
    '缺年份 -> 跳过该段（不出现未标注、不出现连续横线）',
    buildDownloadFileName('', '生态环境局', '云南南涧', 'xlsx'),
    '生态环境局-云南南涧.xlsx',
  )
  eq(
    '缺机构 -> 跳过该段',
    buildDownloadFileName('2024', '', '云南双江', 'xlsx'),
    '2024-云南双江.xlsx',
  )
  eq(
    '年份机构都缺 -> 只剩标题.ext',
    buildDownloadFileName('', '', '云南南江', 'pdf'),
    '云南南江.pdf',
  )
  eq(
    '三段都缺 -> 回落 download.ext（不留裸横线）',
    buildDownloadFileName('', '', '', 'pdf'),
    'download.pdf',
  )
  eq(
    '标题含 Windows 非法字符 \\ / : * ? " < > | -> 替换',
    buildDownloadFileName('2024', 'A/B', '报告:第一*部分?', 'pdf'),
    '2024-A-B-报告-第一-部分.pdf',
  )
  eq(
    '路径穿越（../）被清洗，不产生目录层级',
    buildDownloadFileName('', '', '../../etc/passwd', 'pdf'),
    'etc-passwd.pdf',
  )
  // 扩展名只放行 ^[a-z0-9]{1,10}$，带分隔符的一律整个丢掉（保守：宁可不带扩展名，
  // 也不猜 attacker 想要哪个后缀）
  eq(
    '扩展名注入含路径分隔符 -> 整个丢弃（不带点）',
    buildDownloadFileName('2024', '机构', '标题', 'pdf/../../x'),
    '2024-机构-标题',
  )
  eq(
    '扩展名含空格 -> 丢弃',
    buildDownloadFileName('2024', '机构', '标题', 'p df'),
    '2024-机构-标题',
  )
  eq(
    '扩展名超长（>10 位）-> 丢弃',
    buildDownloadFileName('2024', '机构', '标题', 'a'.repeat(11)),
    '2024-机构-标题',
  )
  eq(
    '扩展名纯数字也放行（上游可能给 "1"）',
    buildDownloadFileName('2024', '机构', '标题', '7z'),
    '2024-机构-标题.7z',
  )
  eq('扩展名缺失 -> 不带点', buildDownloadFileName('2024', '机构', '标题', ''), '2024-机构-标题')
  eq(
    '超长标题被截断到 180 字以内',
    buildDownloadFileName('', '', '标'.repeat(400), 'pdf').length <= 180 + 4,
    true,
  )

  const cd = buildContentDisposition('attachment', '2024-生态环境局-生活垃圾分类工作方案.pdf')
  check(
    'Content-Disposition 带 attachment + filename + filename*',
    cd.startsWith('attachment; filename="') && cd.includes("filename*=UTF-8''"),
    cd,
  )
  check(
    'filename* 百分号编码后不含中文裸字符',
    !/filename\*=UTF-8''[^"]*[\u4e00-\u9fa5]/.test(cd),
    cd,
  )
  check(
    'ascii filename 兜底不含引号（防头注入）',
    /filename="[^"]*"/.test(cd) && !cd.includes('""'),
    cd,
  )
  check(
    'inline 版用于预览',
    buildContentDisposition('inline', 'a.pdf').startsWith('inline; filename="a.pdf"'),
  )
}

// ================================================================ 3. 预览阈值与类型分支
function testPreviewDecision(): void {
  section('3. 预览决策（验收④：tooLarge 字段存在且分支可达）')

  const max = loadPreviewMaxBytes()
  eq('默认阈值 20MB', max, 20 * 1024 * 1024)

  const pdf = decidePreview('pdf', 1_408_332)
  check('pdf 小文件 -> 可流式', pdf.streamable && !pdf.tooLarge && !pdf.unsupported)
  eq('pdf Content-Type', pdf.contentType, 'application/pdf')

  const tooBig = decidePreview('pdf', 20 * 1024 * 1024 + 1)
  check(
    'pdf 超过 20MB -> tooLarge=true 且不可流式',
    tooBig.tooLarge === true && tooBig.streamable === false && tooBig.unsupported === false,
    JSON.stringify(tooBig),
  )
  check(
    'tooLarge 分支带中文原因（前端可直出文案）',
    (tooBig.reason ?? '').includes('超过在线预览上限'),
  )

  const exact = decidePreview('pdf', 20 * 1024 * 1024)
  check('正好 20MB 不算超（边界是 >）', exact.streamable === true, JSON.stringify(exact))

  const xlsx = decidePreview('xlsx', 13_260)
  check(
    'xlsx -> unsupported=true（PDF 之外的类型给提示）',
    xlsx.unsupported === true && xlsx.streamable === false && xlsx.tooLarge === false,
    JSON.stringify(xlsx),
  )
  check('xlsx 分支带中文原因', (xlsx.reason ?? '').includes('.xlsx'))

  const noType = decidePreview('', 0)
  check('类型未知 -> unsupported（体积未知时也不盲开流）', noType.unsupported === true)

  const zeroSize = decidePreview('pdf', 0)
  check(
    '体积未知(0) -> 按可流式处理，先让浏览器探',
    zeroSize.streamable === true && zeroSize.sizeBytes === 0,
  )

  const envMax = decidePreview('pdf', 1500, 1000)
  check('阈值可传入（env 可配常量）', envMax.tooLarge === true)

  check(
    'isPreviewableExtension: pdf true / xlsx false',
    isPreviewableExtension('pdf') && !isPreviewableExtension('xlsx'),
  )
}

// ================================================================ 4. 扩展名归一
function testResolveExtension(): void {
  section('4. 扩展名归一（索引 file_type 缺失时从文件名兜底）')
  eq('file_type 优先', resolveExtension('pdf', '云南南涧.xlsx'), 'pdf')
  eq('带点/大写都归一', resolveExtension('.PDF', 'x.XLSX'), 'pdf')
  eq('file_type 空 -> 从文件名取', resolveExtension('', '云南南涧.xlsx'), 'xlsx')
  eq('file_type null -> 从文件名取', resolveExtension(null, '报告.PDF'), 'pdf')
  eq('两者皆空 -> 空串', resolveExtension('', ''), '')
  eq('无扩展名 -> 空串', resolveExtension('', 'README'), '')
}

// ================================================================ 5. DownloadLog 落库
async function testDownloadLog(): Promise<void> {
  section('5. DownloadLog 落库（userId + docId + 文件名 + 时间）')

  const prisma = getPrisma()
  const before = await prisma.downloadLog.count()

  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (user === null) {
    check('存在可写日志的用户', false, 'users 表为空')
    return
  }

  const probeId = '00000000-0000-4000-8000-000000000000'
  const probeName = 'selftest-写入探测.pdf'
  const ok = await writeDownloadLog(prisma, user.id, probeId, probeName)
  check('writeDownloadLog 返回 true', ok)

  const log = await prisma.downloadLog.findFirst({
    where: { docId: probeId },
    orderBy: { createdAt: 'desc' },
  })
  check('落库行存在', log !== null)
  check('userId 是真实用户 id', log?.userId === user.id, `${log?.userId}`)
  check('docId 是 knowledgeId', log?.docId === probeId)
  check('docTitle 记录重命名后文件名', log?.docTitle === probeName, `${log?.docTitle}`)
  check('fileName（T04 新列）也记录了文件名', log?.fileName === probeName, `${log?.fileName}`)
  check('createdAt 自动落时间', log?.createdAt instanceof Date)

  const after = await prisma.downloadLog.count()
  check('表计数 +1', after === before + 1, `${before} -> ${after}`)

  // 清理探测行（不留垃圾数据给主控验收）
  await prisma.downloadLog.deleteMany({ where: { docId: probeId } })
  const cleaned = await prisma.downloadLog.count()
  check('探测行已清理，表计数复原', cleaned === before, `${cleaned} vs ${before}`)
}

// ================================================================ 6. 详情解析（真实 id）
async function testDetailResolve(): Promise<void> {
  section('6. 详情解析（索引优先 + 回源合并）')
  const prisma = getPrisma()

  const sample = await prisma.knowledgeIndex.findFirst({
    where: { customMetadata: { not: '{}' } },
    orderBy: { knowledgeId: 'asc' },
  })
  const plain = await prisma.knowledgeIndex.findFirst({
    where: { customMetadata: '{}' },
    orderBy: { knowledgeId: 'asc' },
  })

  if (sample !== null) {
    const detail = await resolveDocDetail(sample.knowledgeId, prisma)
    check('填过元数据那条能解析出详情', detail !== null)
    if (detail !== null) {
      check('source 含 index（索引优先）', detail.source.includes('index'), detail.source)
      const corpusId = /^\d+$/.test(sample.knowledgeId)
      if (corpusId) {
        check('语料资料不回源 WeKnora', detail.upstreamAvailable === false)
        const indexedYear = sample.year.trim() === '' ? META_MISSING : sample.year
        eq('年份与索引列一致', detail.metadata.year, indexedYear)
      } else {
        check('非语料资料也不回源引擎', detail.upstreamAvailable === false)
        eq('年份取自 custom_metadata', detail.metadata.year, '2026')
      }
      check('download.fileName 形如 年份-机构-标题.ext', detail.download.fileName.includes('-'))
    }
  } else {
    check('存在填过元数据的样本', false, '索引里全是 {}')
  }

  if (plain !== null) {
    const detail = await resolveDocDetail(plain.knowledgeId, prisma)
    check('空元数据那条也能出详情（不 500）', detail !== null)
    if (detail !== null) {
      check('metadataComplete=false', detail.metadataComplete === false)
      eq('空年份归一为 未标注', detail.metadata.year, META_MISSING)
      check('文件名跳过缺失段', !detail.download.fileName.startsWith('-'), detail.download.fileName)
    }
  }

  const missing = await resolveDocDetail('00000000-0000-4000-8000-000000000000', prisma)
  check('索引与引擎都没有 -> 返回 null（路由转 404）', missing === null)

  await prisma.$disconnect()
}

// ================================================================ 7. 预览票据（工具栏文件名）
function testPreviewTicket(): void {
  section('7. 预览票据：地址最后一段是原文件名，且不能串到别的资料')
  const fileName = '304-社区堆肥综合效益评估报告-社区堆肥综合效益评估报告.pdf'
  const ticket = issuePreviewTicket('doc-compost', false, 60_000)
  const url = buildNamedPreviewUrl('doc-compost', fileName, ticket)
  const leaf = decodeURIComponent(url.split('?')[0]?.split('/').pop() ?? '')

  eq('路径最后一段等于原文件名', leaf, fileName)
  check('查询串带 ticket，不带登录 JWT 的三段式', url.includes('ticket=') && !url.includes('eyJ'))
  eq('同资料票据有效', verifyPreviewTicket(ticket, 'doc-compost')?.allowUnlisted, false)
  check('不能拿去打开另一份资料', verifyPreviewTicket(ticket, 'doc-other') === null)
  check('过期票据失效', verifyPreviewTicket(issuePreviewTicket('doc-old', false, -1), 'doc-old') === null)
  eq('空文件名落到 preview.bin', previewLeafName('  '), 'preview.bin')
  eq('路径分隔符被折成一段', previewLeafName('a/b\\c.pdf'), 'a-b-c.pdf')
  eq('Range 起始区间', parseSingleByteRange('bytes=0-99', 1000), { start: 0, end: 99 })
  eq('Range 读到文件尾', parseSingleByteRange('bytes=0-', 1000), { start: 0, end: 999 })
  eq('Range 后缀', parseSingleByteRange('bytes=-100', 1000), { start: 900, end: 999 })
  eq('Range 越过文件尾被夹住', parseSingleByteRange('bytes=10-5000', 1000), { start: 10, end: 999 })
  eq('Range 起点越界', parseSingleByteRange('bytes=5000-', 1000), 'unsatisfiable')
  check('多段 Range 交给整文件', parseSingleByteRange('bytes=0-1,2-3', 1000) === null)

  const router = readSource('docs.file.router.ts')
  check(
    '换票据的路由挂了 requireAuth',
    router.includes("'/api/docs/:id/preview-ticket', requireAuth"),
  )
  check(
    '带文件名的预览地址不挂 requireAuth',
    !router.includes("'/api/docs/:id/preview-named/:fileName', requireAuth"),
  )
  check('打开预览前核验票据', router.includes('verifyPreviewTicket(ticket, id)'))
}

// ================================================================ 8. 架构断言
function testArchitecture(): void {
  section('8. 架构断言（索引优先 / 模块边界）')
  const repo = readSource('docs.file.repo.ts')
  check('索引 repo 不 import weknora（详情不打引擎拿元数据）', !repo.includes('weknora'))

  const svc = readSource('docs.file.service.ts')
  check(
    'service 里没有 arrayBuffer/bytes 整读（流式透传）',
    !svc.includes('arrayBuffer') && !svc.includes('.bytes'),
  )

  const router = readSource('docs.file.router.ts')
  check('下载路由挂了 requireAuth（登录闸门）', router.includes('requireAuth'))
  check('下载路由用 getAuthContext 解 JWT 取 userId', router.includes('getAuthContext'))
  check(
    '三路由都在本模块 router（不碰 auth/shelf 文件）',
    router.includes("/api/docs/:id'") &&
      router.includes('/api/docs/:id/preview') &&
      router.includes('/api/docs/:id/download'),
  )
  check('用 pipeline 流式转发（不是 res.end(bytes)）', router.includes('pipeline('))
}

async function main(): Promise<void> {
  loadEnvFile()
  testMetadataTolerance()
  testDownloadFileName()
  testPreviewDecision()
  testResolveExtension()
  await testDownloadLog()
  await testDetailResolve()
  testPreviewTicket()
  testArchitecture()

  console.log(`\n=== 汇总：${passed} PASS / ${failures.length} FAIL ===`)
  if (failures.length > 0) {
    for (const f of failures) console.log(`  - ${f}`)
    process.exitCode = 1
  }
}

void main()
