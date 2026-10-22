// 验收：分类、描述长度、状态字段。不连数据库。
import { parseFeedbackCreate, parseFeedbackStatus } from './feedback.validate.js'

let failed = 0

function check(name: string, ok: boolean): void {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

const created = parseFeedbackCreate({
  category: 'content',
  description: '  资料年份写错了  ',
  pagePath: '/doc/abc',
})
check(
  '合法反馈会去掉描述两端空白',
  created.ok && created.value.category === 'content' && created.value.description === '资料年份写错了',
)

const unknown = parseFeedbackCreate({ category: 'nope', description: '页面打不开' })
check('未知分类被拒绝', !unknown.ok)

const blank = parseFeedbackCreate({ category: 'other', description: '  ' })
check('空白描述被拒绝', !blank.ok)

const short = parseFeedbackCreate({ category: 'page', description: '啊' })
check('少于两个字被拒绝', !short.ok)

const long = parseFeedbackCreate({ category: 'idea', description: '建'.repeat(2001) })
check('超过 2000 字被拒绝', !long.ok)

const missing = parseFeedbackCreate(null)
check('空请求体被拒绝', !missing.ok)

const done = parseFeedbackStatus({ status: 'done' })
check('可以标为已处理', done.ok && done.value === 'done')

const reopened = parseFeedbackStatus({ status: 'open' })
check('可以标回未处理', reopened.ok && reopened.value === 'open')

const badStatus = parseFeedbackStatus({ status: 'closed' })
check('非法状态被拒绝', !badStatus.ok)

if (failed > 0) {
  console.error(`feedback selftest failed: ${failed}`)
  process.exitCode = 1
}
