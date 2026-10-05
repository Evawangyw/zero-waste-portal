/**
 * 安徽省六尺巷慈善基金会介绍页的公开信息。
 * 文案依据官网 https://www.lcx-foundation.org.cn/ 公开页面整理，不在此发明事实。
 * 职务、地址、资讯标题均对应官网对应栏目；官网改版后以链接落地页为准。
 */

export const FOUNDATION_HOME = 'https://www.lcx-foundation.org.cn/'

export interface FoundationLink {
  readonly label: string
  readonly href: string
}

export interface FoundationFact {
  readonly label: string
  readonly value: string
}

export interface FoundationDirection {
  readonly title: string
  readonly summary: string
}

export interface FoundationArea {
  readonly title: string
  readonly summary: string
  readonly href: string
  readonly projects: readonly string[]
}

export interface FoundationPerson {
  readonly name: string
  readonly role: string
}

export interface FoundationNews {
  readonly title: string
  readonly date: string
  readonly href: string
}

export const FOUNDATION_FACTS: readonly FoundationFact[] = [
  { label: '成立时间', value: '2017 年 12 月' },
  { label: '创办人', value: '张正扬' },
  { label: '愿景', value: '更高品质和更有文化的生活' },
  { label: '网站备案', value: '皖ICP备2025104469号-1' },
]

/** 2024 年新发展战略的三个方向（机构简介页） */
export const FOUNDATION_DIRECTIONS: readonly FoundationDirection[] = [
  {
    title: '传播优秀传统文化',
    summary: '弘扬包容、谦和、礼让的「六尺巷」精神，把人与人之间的礼让、人与自然之间的共生讲清楚，也做得更有吸引力。',
  },
  {
    title: '助力绿色生活',
    summary: '募集善款，支持绿色生活与可持续消费领域的公益行动，让这些想法获得更多社会资源。',
  },
  {
    title: '推广绿色标准',
    summary: '研究并推广绿色标准、认证和标识，让好环境、好产品离公众更近。',
  },
]

/** 官网「工作专栏」目前展示的领域 */
export const FOUNDATION_AREAS: readonly FoundationArea[] = [
  {
    title: '零废弃',
    summary:
      '关注塑料污染与垃圾分类：一次性塑料过量和回收体系碎片化，以及源头分类不准、收运衔接不畅。专栏同时承接无废相关的资源汇聚与创新支持。',
    href: 'https://www.lcx-foundation.org.cn/h-col-159.html',
    projects: ['巷善计划', '无废行动专项基金'],
  },
  {
    title: '化学品安全与健康',
    summary:
      '关注化学品全生命周期里的健康与环境风险，当前把抗生素耐药作为紧迫议题，并支持新污染物治理领域的民间行动。',
    href: 'https://www.lcx-foundation.org.cn/h-col-160.html',
    projects: ['应用「同一健康」方针遏制抗生素耐药性联合行动', '新污染物治理行动专项基金'],
  },
  {
    title: '行业赋能',
    summary:
      '帮助公益机构补上技术应用、人才培养、传播运营和合规管理的短板，支持小型团队把 AI 用到可持续生活场景里。',
    href: 'https://www.lcx-foundation.org.cn/h-col-162.html',
    projects: ['可持续生活 AI 助手网络'],
  },
  {
    title: '绿色标准与认证',
    summary:
      '从公益视角做可持续标准研究、绿色标识推广和认证咨询，连接电商平台、品牌企业与认证机构。',
    href: 'https://www.lcx-foundation.org.cn/h-col-172.html',
    projects: ['绿标院'],
  },
  {
    title: '文化传承',
    summary:
      '官网首页将文化传承列为工作领域之一。它对应的是机构宗旨：以「六尺巷」精神为核心，传播和弘扬优秀传统文化。',
    href: 'https://www.lcx-foundation.org.cn/h-col-112.html',
    projects: [],
  },
]

/** 理事会和监事会（官网对应栏目，顺序与页面一致） */
export const FOUNDATION_BOARD: readonly FoundationPerson[] = [
  { name: '张正扬', role: '创会理事长' },
  { name: '田倩', role: '理事长' },
  { name: '毛达', role: '理事兼秘书长' },
  { name: '郝利琼', role: '理事' },
  { name: '江海', role: '理事' },
  { name: '张军', role: '副理事长' },
  { name: '赵光', role: '监事长' },
  { name: '张登高', role: '监事' },
  { name: '朱贞艳', role: '监事' },
]

/** 团队成员页公开展示的职务 */
export const FOUNDATION_TEAM: readonly FoundationPerson[] = [
  { name: '毛达', role: '秘书长' },
  { name: '温瑞环', role: '运营总监' },
  { name: '黄正', role: '项目助理' },
]

/** 抓取官网首页时展示的三则最新资讯 */
export const FOUNDATION_NEWS: readonly FoundationNews[] = [
  {
    title: 'GRS/RCS认证全攻略：中国企业出海的「绿色通行证」怎么拿？',
    date: '2026-09-01',
    href: 'https://www.lcx-foundation.org.cn/sys-nd/111.html',
  },
  {
    title: '真实案例拆解——如何从「和AI聊天」到「让AI干活」',
    date: '2026-08-14',
    href: 'https://www.lcx-foundation.org.cn/sys-nd/108.html',
  },
  {
    title: '中国「限塑令」五年考：从政策到行动，我们走了多远？',
    date: '2026-08-07',
    href: 'https://www.lcx-foundation.org.cn/sys-nd/109.html',
  },
]

export const FOUNDATION_PAGES: readonly FoundationLink[] = [
  { label: '机构简介', href: 'https://www.lcx-foundation.org.cn/h-col-112.html' },
  { label: '理事会和监事会', href: 'https://www.lcx-foundation.org.cn/h-col-111.html' },
  { label: '团队成员', href: 'https://www.lcx-foundation.org.cn/h-col-113.html' },
  { label: '联系我们', href: 'https://www.lcx-foundation.org.cn/h-col-123.html' },
  { label: '信息公开', href: 'https://www.lcx-foundation.org.cn/h-col-103.html' },
]
