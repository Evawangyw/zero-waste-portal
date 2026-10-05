/**
 * 资料书架的占位书。索引里还没有真实 PDF 时，用这些书把书架摆出来。
 * 正式文件接入后，页面会改用接口返回的资料，不再显示这批占位书。
 */

export interface ProxyBook {
  readonly id: string
  readonly title: string
  readonly year: string
  readonly org: string
  readonly docType: string
  readonly topics: readonly string[]
  readonly spine: string
  readonly height: number
  readonly pages: readonly string[]
}

export const PROXY_BOOKS: readonly ProxyBook[] = [
  {
    id: 'proxy-sorting-guide',
    title: '生活垃圾分类指导手册',
    year: '2024',
    org: '住房和城乡建设部',
    docType: '政策',
    topics: ['垃圾分类'],
    spine: '#1f6b4a',
    height: 176,
    pages: [
      '这是一本占位书，用来代替尚未入库的 PDF。正式文件接入后，这里会换成原文页。',
      '手册按可回收物、有害垃圾、厨余垃圾和其他垃圾说明投放口径，并列出社区常见的错分情形。',
      '执行层面强调前端分类、分类收运和末端处理要衔接，避免先分后混。',
    ],
  },
  {
    id: 'proxy-plastic-five-year',
    title: '限塑令五年实施情况',
    year: '2025',
    org: '国家发展改革委',
    docType: '政策',
    topics: ['减塑替代'],
    spine: '#8c3a3a',
    height: 164,
    pages: [
      '占位内容：梳理限塑令实施后，商场、外卖和快递三个场景的减量进展。',
      '仍待解决的是替代材料标准不统一，以及回收体系接不住被替换下来的一次性用品。',
    ],
  },
  {
    id: 'proxy-compost',
    title: '社区厨余堆肥活动手册',
    year: '2023',
    org: '六尺巷基金会',
    docType: '实践',
    topics: ['厨余处理', '社区实践'],
    spine: '#3d4f7c',
    height: 188,
    pages: [
      '占位内容：一份社区堆肥活动怎么开场、怎么分工、怎么记录腐熟程度。',
      '适合作为知识库里「场景式」提问的示例材料，正式 PDF 接入后替换。',
    ],
  },
  {
    id: 'proxy-zero-waste-city',
    title: '无废城市建设指标释义',
    year: '2022',
    org: '生态环境部',
    docType: '政策',
    topics: ['垃圾分类'],
    spine: '#6b3a4a',
    height: 170,
    pages: [
      '占位内容：把无废城市试点里和固体废物减量、资源化相关的指标拆成可核对的口径。',
      '本页只示意书架展开后的阅读区，不代表已收录该文件。',
    ],
  },
  {
    id: 'proxy-green-label',
    title: '绿色标识与认证导读',
    year: '2024',
    org: '六尺巷基金会',
    docType: '标准',
    topics: ['绿色消费'],
    spine: '#8a6232',
    height: 158,
    pages: [
      '占位内容：说明常见绿色标识各自证明什么、不证明什么，避免把认证标志当成万能标签。',
      '对应基金会「绿色标准与认证」方向，供书架样式预览。',
    ],
  },
  {
    id: 'proxy-express',
    title: '快递包装减量实践摘录',
    year: '2023',
    org: '国家邮政局',
    docType: '实践',
    topics: ['减塑替代'],
    spine: '#1e4d6b',
    height: 180,
    pages: [
      '占位内容：收录可循环箱、胶带瘦身和原纸填充三类做法，以及试点网点的记录表。',
      '点击书脊后展开的就是这一页，真实 PDF 接入前不会提供下载。',
    ],
  },
  {
    id: 'proxy-school',
    title: '校园零废弃教案',
    year: '2021',
    org: '安徽省教育厅',
    docType: '实践',
    topics: ['教育培训', '垃圾分类'],
    spine: '#3f5c45',
    height: 152,
    pages: [
      '占位内容：三课时教案，从教室垃圾桶观察开始，到一次校园投放检查结束。',
      '主题同时落在教育培训和垃圾分类，方便筛选演示。',
    ],
  },
  {
    id: 'proxy-assessment',
    title: '生活垃圾分类考核要点',
    year: '2020',
    org: '住房和城乡建设部',
    docType: '政策',
    topics: ['垃圾分类', '政策倡导'],
    spine: '#7a5428',
    height: 192,
    pages: [
      '占位内容：把考核里常见的覆盖率、知晓率和收运衔接要求列成对照表。',
      '正式资料入库后，提问「生活垃圾分类工作有哪些考核要求」应优先引用真实文件。',
    ],
  },
  {
    id: 'proxy-chemical',
    title: '消费品化学物质提示',
    year: '2025',
    org: '六尺巷基金会',
    docType: '实践',
    topics: ['绿色消费'],
    spine: '#4a3f35',
    height: 168,
    pages: [
      '占位内容：用通俗说法提示日用品里需要留意的化学物质标识，不提供检测数据。',
      '本条只为占位书架，不替代基金会化学品专栏的正式报告。',
    ],
  },
  {
    id: 'proxy-community',
    title: '社区减塑行动记录',
    year: '2022',
    org: '合肥市蜀山区',
    docType: '实践',
    topics: ['社区实践', '减塑替代'],
    spine: '#016333',
    height: 160,
    pages: [
      '占位内容：一个社区三个月的减塑台账，包括集市摊位和物业会的两次动员。',
      '展开后可看这段摘要；原件 PDF 尚未挂到这本书上。',
    ],
  },
  {
    id: 'proxy-standard',
    title: '再生材料标识简表',
    year: '2024',
    org: '国家市场监督管理总局',
    docType: '标准',
    topics: ['绿色消费', '减塑替代'],
    spine: '#5c3d2e',
    height: 174,
    pages: [
      '占位内容：列出再生材料常见标识和适用场景，方便对照产品包装上的文字。',
      '标准原文仍以正式发布的文件为准。',
    ],
  },
  {
    id: 'proxy-kitchen',
    title: '厨余垃圾处理设施导则',
    year: '2021',
    org: '生态环境部',
    docType: '政策',
    topics: ['厨余处理'],
    spine: '#2c4a6e',
    height: 184,
    pages: [
      '占位内容：说明小型厨余处理设施的选址、臭气和渗滤液这三项最常被问到的要求。',
      '此处为示意页，数字和条款待真实 PDF 替换。',
    ],
  },
]
