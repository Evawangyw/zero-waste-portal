/** 导出 UTF-8 CSV。前面加 BOM，Excel 打开中文才不会乱码。 */

export function downloadCsv(
  filename: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): void {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(','))
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function escapeCell(value: string): string {
  if (/[",\r\n]/u.test(value)) return `"${value.replace(/"/gu, '""')}"`
  return value
}
