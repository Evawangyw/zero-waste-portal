/** 前端通用卡片项类型（T00 占位页用） */
export interface CardItem<TPayload> {
  readonly title: string
  readonly desc: string
  readonly payload?: TPayload
}
