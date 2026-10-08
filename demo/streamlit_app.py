"""零废弃知识库的可点击演示。

书目和规模数字来自站内静态快照。问答只复述这些书目里的句子，不连接 WeKnora。
部署入口是本文件：Streamlit Community Cloud 选 demo/streamlit_app.py。
"""

from __future__ import annotations

import streamlit as st

ZERO_WASTE_TOTAL = 481
CHEMICAL_TOTAL = 125
OVERVIEW_AS_OF = "2026-09-28"

TOPICS: tuple[tuple[str, int], ...] = (
    ("塑料", 99),
    ("垃圾分类", 72),
    ("禁塑", 37),
    ("甲烷", 36),
    ("包装", 36),
    ("零废弃", 33),
    ("废弃物管理", 30),
    ("无废城市", 29),
    ("食物/有机废弃物", 20),
    ("EPR", 19),
    ("再生资源", 17),
    ("循环经济", 15),
    ("电商废弃物", 14),
    ("其他", 14),
    ("行业发展", 4),
    ("环保大类", 4),
    ("低值可回收物", 2),
)

ZERO_WASTE_TYPES: tuple[tuple[str, int], ...] = (
    ("政策法规", 218),
    ("研究报告", 189),
    ("案例工具", 51),
    ("各类标准", 23),
)

CHEMICAL_TYPES: tuple[tuple[str, int], ...] = (
    ("研究实践报告", 62),
    ("各类标准", 31),
    ("国内政策法规", 18),
    ("国际公约", 12),
    ("科学认知", 2),
)

Book = dict[str, str | tuple[str, ...]]

BOOKS: tuple[Book, ...] = (
    {
        "id": "proxy-sorting-guide",
        "title": "生活垃圾分类指导手册",
        "year": "2024",
        "org": "住房和城乡建设部",
        "doc_type": "政策",
        "topics": ("垃圾分类",),
        "pages": (
            "手册按可回收物、有害垃圾、厨余垃圾和其他垃圾说明投放口径，并列出社区常见的错分情形。",
            "执行层面强调前端分类、分类收运和末端处理要衔接，避免先分后混。",
        ),
    },
    {
        "id": "proxy-plastic-five-year",
        "title": "限塑令五年实施情况",
        "year": "2025",
        "org": "国家发展改革委",
        "doc_type": "政策",
        "topics": ("减塑替代",),
        "pages": (
            "梳理限塑令实施后，商场、外卖和快递三个场景的减量进展。",
            "仍待解决的是替代材料标准不统一，以及回收体系接不住被替换下来的一次性用品。",
        ),
    },
    {
        "id": "proxy-compost",
        "title": "社区厨余堆肥活动手册",
        "year": "2023",
        "org": "六尺巷基金会",
        "doc_type": "实践",
        "topics": ("厨余处理", "社区实践"),
        "pages": (
            "一份社区堆肥活动怎么开场、怎么分工、怎么记录腐熟程度。",
            "适合作为知识库里「场景式」提问的示例材料。",
        ),
    },
    {
        "id": "proxy-zero-waste-city",
        "title": "无废城市建设指标释义",
        "year": "2022",
        "org": "生态环境部",
        "doc_type": "政策",
        "topics": ("垃圾分类",),
        "pages": ("把无废城市试点里和固体废物减量、资源化相关的指标拆成可核对的口径。",),
    },
    {
        "id": "proxy-green-label",
        "title": "绿色标识与认证导读",
        "year": "2024",
        "org": "六尺巷基金会",
        "doc_type": "标准",
        "topics": ("绿色消费",),
        "pages": ("说明常见绿色标识各自证明什么、不证明什么，避免把认证标志当成万能标签。",),
    },
    {
        "id": "proxy-express",
        "title": "快递包装减量实践摘录",
        "year": "2023",
        "org": "国家邮政局",
        "doc_type": "实践",
        "topics": ("减塑替代",),
        "pages": ("收录可循环箱、胶带瘦身和原纸填充三类做法，以及试点网点的记录表。",),
    },
    {
        "id": "proxy-school",
        "title": "校园零废弃教案",
        "year": "2021",
        "org": "安徽省教育厅",
        "doc_type": "实践",
        "topics": ("教育培训", "垃圾分类"),
        "pages": ("三课时教案，从教室垃圾桶观察开始，到一次校园投放检查结束。",),
    },
    {
        "id": "proxy-assessment",
        "title": "生活垃圾分类考核要点",
        "year": "2020",
        "org": "住房和城乡建设部",
        "doc_type": "政策",
        "topics": ("垃圾分类", "政策倡导"),
        "pages": ("把考核里常见的覆盖率、知晓率和收运衔接要求列成对照表。",),
    },
    {
        "id": "proxy-chemical",
        "title": "消费品化学物质提示",
        "year": "2025",
        "org": "六尺巷基金会",
        "doc_type": "实践",
        "topics": ("绿色消费",),
        "pages": ("用通俗说法提示日用品里需要留意的化学物质标识，不提供检测数据。",),
    },
    {
        "id": "proxy-community",
        "title": "社区减塑行动记录",
        "year": "2022",
        "org": "合肥市蜀山区",
        "doc_type": "实践",
        "topics": ("社区实践", "减塑替代"),
        "pages": ("一个社区三个月的减塑台账，包括集市摊位和物业会的两次动员。",),
    },
    {
        "id": "proxy-standard",
        "title": "再生材料标识简表",
        "year": "2024",
        "org": "国家市场监督管理总局",
        "doc_type": "标准",
        "topics": ("绿色消费", "减塑替代"),
        "pages": ("列出再生材料常见标识和适用场景，方便对照产品包装上的文字。",),
    },
    {
        "id": "proxy-kitchen",
        "title": "厨余垃圾处理设施导则",
        "year": "2021",
        "org": "生态环境部",
        "doc_type": "政策",
        "topics": ("厨余处理",),
        "pages": ("说明小型厨余处理设施的选址、臭气和渗滤液这三项最常被问到的要求。",),
    },
)

SAMPLE_QUESTIONS: tuple[str, ...] = (
    "零废弃领域有哪些相关政策？",
    "社区厨余堆肥活动怎么设计？",
    "生活垃圾分类工作有哪些考核要求？",
)


def book_by_id(book_id: str) -> Book | None:
    for book in BOOKS:
        if book["id"] == book_id:
            return book
    return None


def topics_of(book: Book) -> tuple[str, ...]:
    topics = book["topics"]
    if isinstance(topics, tuple):
        return topics
    return ()


def pages_of(book: Book) -> tuple[str, ...]:
    pages = book["pages"]
    if isinstance(pages, tuple):
        return pages
    return ()


def text_of(book: Book, key: str) -> str:
    value = book[key]
    if isinstance(value, str):
        return value
    return ""


def cite(book: Book) -> str:
    sentences = "。".join(page.rstrip("。") for page in pages_of(book))
    return f"演示回答，依据《{text_of(book, 'title')}》（{text_of(book, 'org')}，{text_of(book, 'year')}）：{sentences}。"


def answer_for(question: str) -> str:
    text = question.strip()
    if text == "":
        return "先写一个问题，或点下面的示例。"
    if "堆肥" in text or "厨余" in text and "活动" in text:
        book = book_by_id("proxy-compost")
        return cite(book) if book is not None else ""
    if "考核" in text:
        book = book_by_id("proxy-assessment")
        return cite(book) if book is not None else ""
    if "政策" in text:
        policies = [book for book in BOOKS if text_of(book, "doc_type") == "政策"]
        lines = "\n".join(
            f"- 《{text_of(book, 'title')}》，{text_of(book, 'org')}，{text_of(book, 'year')}"
            for book in policies
        )
        return f"演示书目里的政策类资料有这些：\n{lines}"
    if "限塑" in text or "包装" in text or "快递" in text:
        plastic = book_by_id("proxy-plastic-five-year")
        express = book_by_id("proxy-express")
        parts = [cite(book) for book in (plastic, express) if book is not None]
        return "\n\n".join(parts)
    if "分类" in text:
        guide = book_by_id("proxy-sorting-guide")
        return cite(guide) if guide is not None else ""
    return "这句在演示书目里没有对应材料。可以改问分类考核、厨余堆肥，或零废弃相关政策。"


def page_intro() -> None:
    st.title("零废弃知识库")
    st.subheader("安徽省六尺巷慈善基金会")
    st.write("库分两块：零废弃，以及化学品。下面是知识总览快照里的规模、议题和类型。")
    left, right = st.columns(2)
    left.metric("零废弃", f"{ZERO_WASTE_TOTAL} 条", help="政策、研究和社区实践资料")
    right.metric("化学品", f"{CHEMICAL_TOTAL} 条", help="健康与环境风险相关资料")
    st.caption(f"数字标注日期 {OVERVIEW_AS_OF}。正式站点还会按年份往下翻。")

    st.header("零废弃议题")
    st.bar_chart(
        [{"议题": name, "条数": count} for name, count in TOPICS],
        x="议题",
        y="条数",
        horizontal=True,
        sort=False,
        color="#017c40",
        height=520,
    )
    type_col, chemical_col = st.columns(2)
    type_col.subheader("零废弃知识类型")
    type_col.bar_chart(
        [{"类型": name, "条数": count} for name, count in ZERO_WASTE_TYPES],
        x="类型",
        y="条数",
        sort=False,
        color="#017c40",
    )
    chemical_col.subheader("化学品知识类型")
    chemical_col.bar_chart(
        [{"类型": name, "条数": count} for name, count in CHEMICAL_TYPES],
        x="类型",
        y="条数",
        sort=False,
        color="#016333",
    )


def page_ask() -> None:
    st.title("向知识库提问")
    st.write("点示例问题，或自己输入。回答只复述演示书目里的句子。")
    if "messages" not in st.session_state:
        st.session_state.messages = []

    for question in SAMPLE_QUESTIONS:
        if st.button(question, key=f"sample-{question}"):
            st.session_state.messages.append({"role": "user", "content": question})
            st.session_state.messages.append({"role": "assistant", "content": answer_for(question)})

    draft = st.chat_input("例如：社区厨余堆肥活动怎么设计？")
    if isinstance(draft, str) and draft.strip() != "":
        st.session_state.messages.append({"role": "user", "content": draft.strip()})
        st.session_state.messages.append({"role": "assistant", "content": answer_for(draft)})

    for message in st.session_state.messages:
        role = message["role"]
        speaker = "user" if role == "user" else "assistant"
        with st.chat_message(speaker):
            st.write(message["content"])

    if st.session_state.messages and st.button("清空这一轮"):
        st.session_state.messages = []
        st.rerun()


def filtered_books() -> list[Book]:
    years = st.session_state.get("filter_year", [])
    orgs = st.session_state.get("filter_org", [])
    types = st.session_state.get("filter_type", [])
    topics = st.session_state.get("filter_topic", [])
    keyword = str(st.session_state.get("filter_q", "")).strip()
    chosen: list[Book] = []
    for book in BOOKS:
        if years and text_of(book, "year") not in years:
            continue
        if orgs and text_of(book, "org") not in orgs:
            continue
        if types and text_of(book, "doc_type") not in types:
            continue
        if topics and not any(topic in topics_of(book) for topic in topics):
            continue
        if keyword and keyword not in text_of(book, "title"):
            continue
        chosen.append(book)
    return chosen


def page_shelf() -> None:
    st.title("资料书架")
    st.write(f"演示书目 {len(BOOKS)} 本。筛选会立刻生效。点「打开」看这一本的摘要。")

    years = sorted({text_of(book, "year") for book in BOOKS}, reverse=True)
    orgs = sorted({text_of(book, "org") for book in BOOKS})
    types = sorted({text_of(book, "doc_type") for book in BOOKS})
    topics = sorted({topic for book in BOOKS for topic in topics_of(book)})

    keyword = st.text_input("按标题搜索", key="filter_q", placeholder="例如：垃圾分类")
    year_col, org_col, type_col, topic_col = st.columns(4)
    year_col.multiselect("年份", years, key="filter_year")
    org_col.multiselect("发布机构", orgs, key="filter_org")
    type_col.multiselect("知识类型", types, key="filter_type")
    topic_col.multiselect("主题", topics, key="filter_topic")
    del keyword

    matches = filtered_books()
    st.caption(f"当前 {len(matches)} 本")
    if not matches:
        st.info("没有匹配的资料。把筛选清掉再看。")
        return

    for book in matches:
        book_id = text_of(book, "id")
        with st.container(border=True):
            title_col, action_col = st.columns([5, 1])
            title_col.markdown(f"**{text_of(book, 'title')}**")
            title_col.caption(
                " · ".join(
                    part
                    for part in (
                        text_of(book, "year"),
                        text_of(book, "org"),
                        text_of(book, "doc_type"),
                        "、".join(topics_of(book)),
                    )
                    if part != ""
                )
            )
            if action_col.button("打开", key=f"open-{book_id}"):
                st.session_state.book_id = book_id

    opened = book_by_id(str(st.session_state.get("book_id", "")))
    if opened is None or opened not in matches:
        return
    st.divider()
    st.header(text_of(opened, "title"))
    meta_left, meta_mid, meta_right = st.columns(3)
    meta_left.metric("年份", text_of(opened, "year"))
    meta_mid.metric("机构", text_of(opened, "org"))
    meta_right.metric("类型", text_of(opened, "doc_type"))
    st.write("主题：" + "、".join(topics_of(opened)))
    for paragraph in pages_of(opened):
        st.write(paragraph)
    st.caption("演示稿没有挂上 PDF，所以这里不提供预览和下载。")


def main() -> None:
    st.set_page_config(page_title="零废弃知识库演示", layout="wide")
    st.caption("可点击演示。翻页、筛选和示例提问都在这个页面里完成，不连接知识库，地址发布后不会跟着电脑关机失效。")
    page = st.navigation(
        [
            st.Page(page_intro, title="知识库介绍", default=True),
            st.Page(page_ask, title="提问"),
            st.Page(page_shelf, title="资料书架"),
        ],
        position="top",
    )
    page.run()


main()
