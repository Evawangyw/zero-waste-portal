// 自测（纯离线，不打网络）：批量导入的映射/解析/幂等/重试/报告口径
// 跑法：npm run test:ingest --workspace backend
// 打真库的验收是另一条命令：npm run ingest --workspace backend -- --kb <id> --input ../inputs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import * as XLSX from 'xlsx'
import { loadMapping, MappingConfigError } from './ingest.mapping.js'
import { parseWorkbook, splitMultiValue } from './ingest.excel.js'
import { renderReportText } from './ingest.report.js'
import { runIngest, INGEST_RETRY_TIMES, type RunIngestOptions } from './ingest.run.js'
import { resolveContentType } from './ingest.uploader.js'
import type { IngestMapping, IngestUploader } from './ingest.types.js'

let passed = 0
let failed = 0

function ok(label: string, cond: boolean, extra = ''): void {
  if (cond) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.error(`  FAIL  ${label}${extra === '' ? '' : `  (${extra})`}`)
  }
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  ok(label, a === b, `期望 ${b}，实际 ${a}`)
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`)
}

function readBinary(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path))
}

// ---------------------------------------------------------------- 假上传器

interface FakeOptions {
  /** 已存在的文件名（大小写不敏感） */
  readonly existing?: readonly string[]
  /** 这些文件名上传必失败（模拟 WeKnora 500） */
  readonly failOn?: readonly string[]
  /** 第几次尝试开始成功（模拟瞬时故障后重试成功） */
  readonly failUntilAttempt?: Readonly<Record<string, number>>
}

interface FakeUploader extends IngestUploader {
  readonly calls: { uploads: string[]; writes: string[] }
  readonly attempts: Map<string, number>
}

function makeFake(options: FakeOptions = {}): FakeUploader {
  const existing = new Set((options.existing ?? []).map((n) => n.toLowerCase()))
  const failOn = new Set((options.failOn ?? []).map((n) => n.toLowerCase()))
  const failUntil = options.failUntilAttempt ?? {}
  const calls = { uploads: [] as string[], writes: [] as string[] }
  const attempts = new Map<string, number>()
  let seq = 0
  return {
    calls,
    attempts,
    async listExistingFileNames(): Promise<ReadonlySet<string>> {
      return new Set(existing)
    },
    async uploadFile(p): Promise<string> {
      calls.uploads.push(p.fileName)
      const key = p.fileName.toLowerCase()
      const n = (attempts.get(key) ?? 0) + 1
      attempts.set(key, n)
      const until = failUntil[key]
      if (until !== undefined && n < until) throw new Error('模拟瞬时 500')
      if (failOn.has(key)) throw new Error('模拟永久失败')
      seq += 1
      existing.add(key)
      return `kid-${seq}`
    },
    async writeMetadata(id): Promise<void> {
      calls.writes.push(id)
    },
  }
}

// ---------------------------------------------------------------- 临时输入目录

const FIXTURE_MAPPING: IngestMapping = {
  headerRow: 1,
  sheet: null,
  fileColumn: '文件名',
  emptyValue: '未标注',
  multiValueJoiner: '、',
  fields: [
    { column: '文件名', key: '文件名', multiValue: false },
    { column: '知识名', key: '知识名', multiValue: false },
    { column: '知识发布机构', key: '知识发布机构', multiValue: false },
    { column: '知识发布年份', key: '知识发布年份', multiValue: false },
    { column: '知识类型', key: '知识类型', multiValue: false },
    { column: '知识领域', key: '知识领域', multiValue: true },
  ],
}

const FIXTURE_ROWS: readonly (readonly (string | number)[])[] = [
  ['a.pdf', '甲文档', '示例机构', 2023, '指引', '垃圾分类、塑料'],
  ['b.pdf', '乙文档', '示例机构', 2024, '指南', '厨余垃圾'],
  ['c.pdf', '丙文档', '', '', '', ''],
]

interface Fixture {
  readonly dir: string
  cleanup(): void
}

function makeFixture(rows: readonly (readonly (string | number)[])[] = FIXTURE_ROWS): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-selftest-'))
  const header = FIXTURE_MAPPING.fields.map((f) => f.column)
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows] as (string | number)[][])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '元数据')
  // XLSX.write 的返回类型在 strict 下是 any，这里显式转成 Buffer 再交给 writeFileSync
  const buf: unknown = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' })
  if (!(buf instanceof Uint8Array)) throw new Error('XLSX.write 未返回预期的二进制内容')
  writeFileSync(join(dir, 'metadata.xlsx'), buf)
  writeFileSync(
    join(dir, 'mapping.json'),
    JSON.stringify({
      headerRow: 1,
      sheet: null,
      fileColumn: '文件名',
      emptyValue: '未标注',
      multiValueJoiner: '、',
      fields: FIXTURE_MAPPING.fields,
    }),
  )
  return { dir: resolve(dir), cleanup: (): void => rmSync(dir, { recursive: true, force: true }) }
}

function baseOptions(dir: string, uploader: IngestUploader, retries = 0): RunIngestOptions {
  return {
    knowledgeBaseId: 'test-kb',
    inputDir: dir,
    excelFileName: 'metadata.xlsx',
    mappingFileName: 'mapping.json',
    filesSubDir: 'files',
    uploader,
    retries,
  }
}

// ================================================================ 1. 多值拆分

function case1(): void {
  section('1. 多值领域拆数组 + 空值落「未标注」')
  const fx = makeFixture()
  try {
    const mapping = loadMapping(join(fx.dir, 'mapping.json'))
    const parsed = parseWorkbook(readBinary(join(fx.dir, 'metadata.xlsx')), mapping)
    eq('行数 = 3', parsed.rows.length, 3)
    eq(
      '表头正确',
      [...parsed.headerLine],
      ['文件名', '知识名', '知识发布机构', '知识发布年份', '知识类型', '知识领域'],
    )

    const r1 = parsed.rows[0]
    eq('第 1 行 知识领域拆成数组', r1?.multiValues['知识领域'], ['垃圾分类', '塑料'])
    eq('第 1 行 写入值为顿号拼接字符串', r1?.metadata['知识领域'], '垃圾分类、塑料')
    eq('第 1 行 年份字符串化', r1?.metadata['知识发布年份'], '2023')

    const r3 = parsed.rows[2]
    eq('第 3 行 机构空 -> 未标注', r3?.metadata['知识发布机构'], '未标注')
    eq('第 3 行 年份空 -> 未标注', r3?.metadata['知识发布年份'], '未标注')
    eq('第 3 行 类型空 -> 未标注', r3?.metadata['知识类型'], '未标注')
    eq('第 3 行 领域空 -> 未标注', r3?.metadata['知识领域'], '未标注')
    eq('第 3 行 名称非空保留', r3?.metadata['知识名'], '丙文档')
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 2. 多值分隔符

function case2(): void {
  section('2. 多值分隔符覆盖 / 去重 / 保序')
  eq('半角逗号', [...splitMultiValue('a,b')], ['a', 'b'])
  eq('顿号', [...splitMultiValue('a、b')], ['a', 'b'])
  eq('分号 + 竖线', [...splitMultiValue('a;b|c')], ['a', 'b', 'c'])
  eq('斜杠', [...splitMultiValue('a/b')], ['a', 'b'])
  eq('换行', [...splitMultiValue('a\nb')], ['a', 'b'])
  eq('去重保序', [...splitMultiValue('a、b、a')], ['a', 'b'])
  eq('全角空格折叠', [...splitMultiValue('a　 b')], ['a', 'b'])
  eq('空串 -> 空数组', [...splitMultiValue('')], [])
  eq('纯分隔符 -> 空数组', [...splitMultiValue('、、')], [])
}

// ================================================================ 3. 映射配置

function case3(): void {
  section('3. mapping.json 是唯一映射处（列名写错必须报错，不静默）')
  const fx = makeFixture()
  try {
    const wrongPath = join(fx.dir, 'wrong.json')

    writeFileSync(
      wrongPath,
      JSON.stringify({
        fileColumn: '文件名',
        fields: [
          { column: '文件名', key: '文件名', multiValue: false },
          { column: '不存在的列', key: 'X', multiValue: false },
        ],
      }),
    )
    let threw: unknown = null
    try {
      parseWorkbook(readBinary(join(fx.dir, 'metadata.xlsx')), loadMapping(wrongPath))
    } catch (err) {
      threw = err
    }
    ok('列名不存在时抛 MappingConfigError', threw instanceof MappingConfigError, String(threw))
    ok('报错信息含实际表头', String(threw).includes('实际表头'), String(threw))

    let threw2: unknown = null
    try {
      writeFileSync(
        wrongPath,
        JSON.stringify({ fileColumn: '文件名', fields: [{ column: '知识名', key: '知识名' }] }),
      )
      loadMapping(wrongPath)
    } catch (err) {
      threw2 = err
    }
    ok('fileColumn 不在 fields 里时报错', threw2 instanceof MappingConfigError)

    let threw3: unknown = null
    try {
      writeFileSync(wrongPath, '{ not json')
      loadMapping(wrongPath)
    } catch (err) {
      threw3 = err
    }
    ok('非法 JSON 报 MappingConfigError', threw3 instanceof MappingConfigError)

    let threw4: unknown = null
    try {
      writeFileSync(
        wrongPath,
        JSON.stringify({
          fileColumn: '文件名',
          headerRow: 0,
          fields: [{ column: '文件名', key: '文件名' }],
        }),
      )
      loadMapping(wrongPath)
    } catch (err) {
      threw4 = err
    }
    ok('headerRow 非正整数报错', threw4 instanceof MappingConfigError)

    writeFileSync(wrongPath, JSON.stringify({ fields: [{ column: '文件名', key: '文件名' }] }))
    const m = loadMapping(wrongPath)
    eq('缺省 headerRow=1', m.headerRow, 1)
    eq('缺省 emptyValue=未标注', m.emptyValue, '未标注')
    eq('缺省 multiValueJoiner=、', m.multiValueJoiner, '、')
    eq('缺省 fileColumn=文件名', m.fileColumn, '文件名')
    eq('multiValue 缺省 false', m.fields[0]?.multiValue, false)
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 4. 正常导入

async function case4(): Promise<void> {
  section('4. 正常导入：3 条全成功，元数据逐字段写入')
  const fx = makeFixture()
  try {
    const fake = makeFake()
    const res = await runIngest(baseOptions(fx.dir, fake))
    eq('total=3', res.report.total, 3)
    eq('succeeded=3', res.report.succeeded, 3)
    eq('skipped=0', res.report.skipped, 0)
    eq('failed=0', res.report.failed, 0)
    eq('上传次数=3', fake.calls.uploads.length, 3)
    eq('写元数据次数=3', fake.calls.writes.length, 3)
    const first = res.report.results[0]
    ok(
      '第 1 条拿到 knowledgeId',
      (first?.knowledgeId ?? '').startsWith('kid-'),
      String(first?.knowledgeId),
    )
    eq('第 1 条元数据留档在报告里', first?.metadata['知识领域'], '垃圾分类、塑料')
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 5. 幂等

async function case5(): Promise<void> {
  section('5. 幂等：文件名已存在则跳过，重复跑不重复导入')
  const fx = makeFixture()
  try {
    const fake = makeFake()
    const first = await runIngest(baseOptions(fx.dir, fake))
    eq('第一遍成功 3 条', first.report.succeeded, 3)

    const second = await runIngest(baseOptions(fx.dir, fake))
    eq('第二遍 skipped=3', second.report.skipped, 3)
    eq('第二遍 succeeded=0', second.report.succeeded, 0)
    eq('第二遍 failed=0', second.report.failed, 0)
    eq(
      '第二遍理由全为「已存在」',
      second.report.results.map((r) => r.reason),
      ['已存在', '已存在', '已存在'],
    )
    eq('上传次数仍为 3（没再上传）', fake.calls.uploads.length, 3)
  } finally {
    fx.cleanup()
  }
}

async function case5b(): Promise<void> {
  section('5b. 幂等大小写不敏感')
  const fx = makeFixture()
  try {
    const fake = makeFake({ existing: ['A.PDF'] })
    const res = await runIngest(baseOptions(fx.dir, fake))
    eq('a.pdf 因大小写命中被跳过', res.report.results[0]?.outcome, 'skipped')
    eq('其余 2 条成功', res.report.succeeded, 2)
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 6. 失败与重试

async function case6(): Promise<void> {
  section('6. 失败重试 2 次 + 报告给失败原因')
  const fx = makeFixture()
  try {
    const fake = makeFake({ failOn: ['b.pdf'] })
    const res = await runIngest(baseOptions(fx.dir, fake, INGEST_RETRY_TIMES))
    eq('a/c 成功 2 条', res.report.succeeded, 2)
    eq('b 失败 1 条', res.report.failed, 1)
    eq('b 尝试 3 次（首次 + 重试 2）', res.report.results[1]?.attempts, 3)
    ok('b 带失败原因', (res.report.results[1]?.reason ?? '').includes('模拟永久失败'))
    eq('上传调用次数 = 1+3+1 = 5', fake.calls.uploads.length, 5)
  } finally {
    fx.cleanup()
  }
}

async function case6b(): Promise<void> {
  section('6b. 瞬时故障重试后成功')
  const fx = makeFixture()
  try {
    const fake = makeFake({ failUntilAttempt: { 'b.pdf': 3 } })
    const res = await runIngest(baseOptions(fx.dir, fake, INGEST_RETRY_TIMES))
    eq('3 条全成功', res.report.succeeded, 3)
    eq('b 尝试 3 次', res.report.results[1]?.attempts, 3)
  } finally {
    fx.cleanup()
  }
}

async function case6c(): Promise<void> {
  section('6c. 重试前复查：上传其实成功（回包丢）时不造重复')
  const fx = makeFixture()
  try {
    let listCalls = 0
    const inner = makeFake()
    const uploader: IngestUploader = {
      async listExistingFileNames(kbId: string): Promise<ReadonlySet<string>> {
        listCalls += 1
        return inner.listExistingFileNames(kbId)
      },
      async uploadFile(p): Promise<string> {
        // 第 1 次：先入库再抛错（模拟 WeKnora 已收但回包失败）
        if (p.fileName === 'a.pdf' && (inner.attempts.get('a.pdf') ?? 0) === 0) {
          await inner.uploadFile(p)
          throw new Error('模拟回包丢失')
        }
        return inner.uploadFile(p)
      },
      async writeMetadata(id, md): Promise<void> {
        return inner.writeMetadata(id, md)
      },
    }
    const res = await runIngest(baseOptions(fx.dir, uploader, INGEST_RETRY_TIMES))
    const a = res.report.results[0]
    eq('a 判定成功（幂等命中）', a?.outcome, 'success')
    ok('a 理由说明幂等命中', (a?.reason ?? '').includes('幂等命中'), String(a?.reason))
    ok('确实做过复查', listCalls >= 2, `listExistingFileNames 调用 ${listCalls} 次`)
    eq('a 只真正上传 1 次', inner.calls.uploads.filter((n) => n === 'a.pdf').length, 1)
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 7. 解析期错误

async function case7(): Promise<void> {
  section('7. 文件名为空 -> 该行记解析失败，不中断其它行')
  const fx = makeFixture([
    ['a.pdf', '甲', '机构', 2023, '指引', '垃圾分类'],
    ['', '无名文件', '机构', 2023, '指引', '垃圾分类'],
    ['c.pdf', '丙', '', '', '', ''],
  ])
  try {
    const fake = makeFake()
    const res = await runIngest(baseOptions(fx.dir, fake))
    eq('解析成功 2 行', res.report.total, 2)
    eq('解析失败 1 行', res.parseErrors.length, 1)
    eq('失败行号 = 3', res.parseErrors[0]?.excelRow, 3)
    ok('失败原因含「文件名为空」', (res.parseErrors[0]?.reason ?? '').includes('文件名为空'))
    eq('成功的 2 条都上传了', fake.calls.uploads.length, 2)
  } finally {
    fx.cleanup()
  }
}

async function case7b(): Promise<void> {
  section('7b. 全空行跳过（Excel 尾部空白不污染报告）')
  const fx = makeFixture([
    ['a.pdf', '甲', '机构', 2023, '指引', '垃圾分类'],
    ['', '', '', '', '', ''],
  ])
  try {
    const res = await runIngest(baseOptions(fx.dir, makeFake()))
    eq('只 1 行进入导入', res.report.total, 1)
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 8. dry-run

async function case8(): Promise<void> {
  section('8. dry-run 不上传')
  const fx = makeFixture()
  try {
    const fake = makeFake()
    const res = await runIngest({ ...baseOptions(fx.dir, fake), dryRun: true })
    eq('dry-run 上传 0 次', fake.calls.uploads.length, 0)
    eq('全部标 skipped', res.report.skipped, 3)
    ok(
      '理由含 dry-run',
      res.report.results.every((r) => r.reason.includes('dry-run')),
    )
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 9. 报告渲染

async function case9(): Promise<void> {
  section('9. 报告三张清单 + 失败原因 + 元数据留档')
  const fx = makeFixture()
  try {
    const fake = makeFake({ existing: ['a.pdf'], failOn: ['b.pdf'] })
    const res = await runIngest(baseOptions(fx.dir, fake, 0))
    const text = renderReportText(res.report)
    ok('含「成功清单」', text.includes('## 成功清单'))
    ok('含「跳过清单」', text.includes('## 跳过清单'))
    ok('含「失败清单」', text.includes('## 失败清单'))
    ok('跳过清单带「已存在」', text.includes('已存在'))
    ok('失败清单带原因', text.includes('模拟永久失败'))
    ok('每行都留 custom_metadata', text.includes('custom_metadata'))
    ok('空值「未标注」出现在报告里', text.includes('未标注'))
    ok('多值拼接结果出现在报告里', text.includes('垃圾分类、塑料'))
  } finally {
    fx.cleanup()
  }
}

// ================================================================ 10. MIME

function case10(): void {
  section('10. Content-Type 推断')
  eq('.pdf', resolveContentType('a.pdf'), 'application/pdf')
  eq(
    '.docx',
    resolveContentType('a.docx'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  )
  eq('.txt', resolveContentType('a.txt'), 'text/plain; charset=utf-8')
  eq('无扩展名', resolveContentType('a'), 'application/octet-stream')
  eq('未知扩展名', resolveContentType('a.zzz'), 'application/octet-stream')
  eq('大写扩展名', resolveContentType('A.PDF'), 'application/pdf')
}

// ---------------------------------------------------------------- 入口

async function main(): Promise<void> {
  case1()
  case2()
  case3()
  await case4()
  await case5()
  await case5b()
  await case6()
  await case6b()
  await case6c()
  await case7()
  await case7b()
  await case8()
  await case9()
  case10()

  console.log(`\n${'='.repeat(56)}`)
  console.log(`通过 ${passed} ｜ 失败 ${failed}`)
  if (failed > 0) process.exitCode = 1
}

main().catch((err: unknown) => {
  console.error('[ingest-selftest] 崩溃：', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
