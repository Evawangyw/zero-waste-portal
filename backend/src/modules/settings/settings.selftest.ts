// 取消管理权限时，不能取消自己，也不能取消最后一位管理员。
import { adminChangeError } from './settings.store.js'

const messageForSelf = adminChangeError('admin-a', 'admin-a', false, ['admin-a', 'admin-b'])
const messageForLast = adminChangeError('admin-a', 'admin-b', false, ['admin-b'])
const allowed = adminChangeError('admin-a', 'admin-b', false, ['admin-a', 'admin-b'])
const keep = adminChangeError('admin-a', 'admin-b', true, ['admin-a', 'admin-b'])

let failed = 0
function check(name: string, ok: boolean): void {
  if (!ok) failed += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
}

check('不能取消自己的管理权限', messageForSelf === '不能取消自己的管理权限')
check('至少留下一位管理员', messageForLast === '至少要留下一位管理员')
check('还有其他管理员时可以取消', allowed === null)
check('授予管理权限不受限', keep === null)

if (failed > 0) {
  console.error(`settings selftest failed: ${failed}`)
  process.exitCode = 1
}
