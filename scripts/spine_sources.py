import json
import re
from urllib.parse import urlsplit

from bs4 import BeautifulSoup, Comment, NavigableString

SOURCE_URLS = {
    "120ask": ("www.120ask.com", r"/question/([0-9]{1,20})\.htm"),
    "xywy": ("club.xywy.com", r"/wenda/([0-9]{1,20})\.htm"),
    "patientinfo": ("patient.info", r"/forums/discuss/[a-z0-9-]+-([0-9]{1,20})/?"),
    "ask39": ("ask.39.net", r"/question/([A-Za-z0-9_-]{1,40})\.html"),
    "healthunlocked": ("healthunlocked.com", r"/[a-z0-9-]+/posts/([0-9]{1,20})(?:/[a-z0-9-]+)?/?"),
    "mayoclinic": ("connect.mayoclinic.org", r"/discussion/([a-z0-9-]{1,100})/?"),
}
ASK39_LISTS = (
    "https://ask.39.net/browse/11760-1-1.html",
    "https://ask.39.net/browse/11760-1-2.html",
    "https://ask.39.net/browse/11760-1-10.html",
    "https://ask.39.net/browse/11760-1-50.html",
    "https://ask.39.net/browse/11760-1-100.html",
    "https://ask.39.net/browse/625-1-1.html",
    "https://ask.39.net/browse/625-1-2.html",
    "https://ask.39.net/browse/625-1-5.html",
    "https://ask.39.net/browse/625-1-10.html",
    "https://ask.39.net/browse/625-1-50.html",
)
SPINE = re.compile(
    r"颈椎|腰椎|腰突|腰痛|腰疼|腰部|椎间盘|椎管|坐骨神经|腰[1-5]|"
    r"\b(?:lumbar|cervical|stenosis|sciatica|spine|spinal|ACDF|L[1-5]|S1|"
    r"lower back|scoliosis|radiculopathy|spondylosis|herniated disc|laminectomy|discectomy|microdiscectomy)\b", re.I
)
IDENTIFIER = re.compile(
    r"(?<!\d)(?:1[3-9]\d{9}|\d{17}[\dXx])(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|"
    r"(?:姓名|住址|联系电话|身份证号|手机号|微信号|病历号|报告编号)\s*[:：]|"
    r"\b(?:my full name is|my phone number is|my address is|my email is)\b", re.I
)
INCOMPLETE = re.compile(
    r"见(?:附件|附图|下图)|图片已隐藏|内容已隐藏|仅医生可见|登录后查看|点击查看全文"
)


def source_id(site, url):
    if not isinstance(url, str) or not 1 <= len(url) <= 300:
        raise ValueError("invalid_candidate_url")
    address = urlsplit(url)
    if site == "patientinfo" and address.scheme == "https" and address.netloc == "community.patient.info" and not (address.query or address.fragment):
        modern = re.fullmatch(r"/t/[a-z0-9-]+/([0-9]{1,20})/?", address.path, re.I)
        if modern:
            return modern.group(1)
    host, pattern = SOURCE_URLS[site]
    match = re.fullmatch(pattern, address.path, re.I)
    if address.scheme != "https" or address.netloc != host or address.query or address.fragment or not match:
        raise ValueError("invalid_candidate_url")
    return match.group(1)


def html_text(tag):
    chunks = []

    def walk(node):
        if isinstance(node, Comment):
            return
        if isinstance(node, NavigableString):
            chunks.append(re.sub(r"[\t\r\n ]+", " ", str(node)))
        elif node.name == "br":
            chunks.append("\n")
        elif node.name not in ("script", "style", "noscript", "button"):
            block = node.name in ("p", "div", "li", "blockquote", "pre")
            if block:
                chunks.append("\n")
            for child in node.children:
                walk(child)
            if block:
                chunks.append("\n")

    walk(tag)
    return "\n".join(line.strip() for line in "".join(chunks).strip().splitlines()).strip()


def parse_xywy(markup):
    page = BeautifulSoup(markup, "html.parser")
    title = page.select_one("h1")
    question = page.select_one(".ask-th-box")
    details = page.select_one(".ask-details-box")
    sections = list(filter(None, (question, details)))
    answers = page.select(".ask-con")
    counts = {len(answers), len(page.select(".ask-doc-box")), len(page.select(".ask-title"))}
    if not title or not sections or not answers or len(counts) != 1:
        raise ValueError("question_or_answer_structure_unverified")
    if any(section.select_one("img,video,iframe") for section in sections + answers):
        raise ValueError("uncollected_media")
    if any(re.search(r"更多回答|展开全部|提问人的追问|医生的回复|患者追问", node.get_text(strip=True))
           for node in page.select("a,button,.ask-con")):
        raise ValueError("unverified_followup_or_hidden_replies")
    return {
        "title": html_text(title),
        "body": "\n".join(dict.fromkeys(filter(None, map(html_text, sections)))),
        "source_lang": "zh-CN",
        "comments": [{"body": html_text(node), "source_lang": "zh-CN"} for node in answers],
    }


def parse_patientinfo(data, expected_id):
    stream = data["post_stream"]
    posts = stream["posts"]
    numbers = [post["post_number"] for post in posts]
    if (str(data.get("id")) != expected_id or len(posts) < 3
            or numbers[0] != 1 or numbers != sorted(set(numbers))
            or [post["id"] for post in posts] != stream["stream"]
            or data.get("posts_count") != len(posts)):
        raise ValueError("public_reply_stream_incomplete")
    by_number = {}
    roots = []
    for post in posts:
        markup = post.get("cooked")
        if not markup or post.get("deleted_at") or post.get("hidden"):
            raise ValueError("missing_or_hidden_post")
        content = BeautifulSoup(markup, "html.parser")
        if content.select_one("img,video,iframe,a.attachment,[data-upload-id]"):
            raise ValueError("uncollected_media")
        number = post["post_number"]
        item = {"body": html_text(content), "source_lang": "en"}
        by_number[number] = item
        if number == 1:
            continue
        parent = post.get("reply_to_post_number")
        if parent in (None, 0, 1):
            roots.append(item)
        elif isinstance(parent, int) and parent < number and parent in by_number:
            by_number[parent].setdefault("replies", []).append(item)
        else:
            raise ValueError("missing_reply_parent")
    return {"title": data["title"], **by_number[1], "comments": roots}



def source_text(node):
    if node.select_one("img, video, iframe, audio, [data-attachment]"):
        raise ValueError("uncollected_media")
    return html_text(node)


def parse_ask39(markup):
    page = BeautifulSoup(markup, "html.parser")
    title = page.select_one("h1.ask_tit")
    question = page.select_one(".ask_hid .txt_ms")
    supplement = page.select_one(".ask_hid .txt_bc span")
    if not title or not question:
        raise ValueError("question_structure_unverified")

    title_text = source_text(title)
    body = re.sub(r"^病情描述[：:]\s*", "", source_text(question))
    extra = source_text(supplement) if supplement else ""
    unique_body = re.sub(r"[\s，。？！、：；,.?!:;]", "", body)
    unique_title = re.sub(r"[\s，。？！、：；,.?!:;]", "", title_text)
    unique_extra = re.sub(r"[\s，。？！、：；,.?!:;]", "", extra)
    if unique_extra and unique_extra not in (unique_title, unique_body):
        body += "\n" + extra
    personal_context = re.search(
        r"我|本人|家人|父亲|母亲|[0-9一二三四五六七八九十]+[年月周天岁]|术后|复发|诊断|检查", body
    )
    if len(re.sub(r"\s+", "", body)) < 24:
        raise ValueError("patient_narrative_too_short")
    if not personal_context:
        raise ValueError("patient_narrative_unverified")

    comments = []
    ids = set()
    for doctor in page.select('div.doctor_all[id^="reply_"]'):
        identifier = doctor["id"]
        if identifier in ids:
            raise ValueError("duplicate_answer_id")
        ids.add(identifier)
        wrapper = doctor.parent
        texts = wrapper.find_all("p", class_="sele_txt", recursive=False)
        if len(texts) != 1 or wrapper.select_one('div[id^="reply_"] div[id^="reply_"]'):
            raise ValueError("answer_structure_unverified")
        body_text = source_text(texts[0])
        if not body_text or re.search(r"查看全部|展开全文|追问|继续阅读", body_text):
            raise ValueError("answer_structure_unverified")
        if any(re.fullmatch(r"展开.*|查看全部.*|加载更多.*|追问.*", html_text(link))
               for link in wrapper.select("a, button") if html_text(link)):
            raise ValueError("answer_structure_unverified")
        comments.append({"body": body_text, "source_lang": "zh-CN"})
    if not comments or len(comments) != len(page.select(".sele_all p.sele_txt")):
        raise ValueError("answer_count_unverified")
    return {"title": title_text, "body": body, "source_lang": "zh-CN", "comments": comments}


def parse_healthunlocked(markup, expected_id):
    page = BeautifulSoup(markup, "html.parser")
    title = page.select_one("#js-post-heading")
    body = page.select_one(".js-post-body")
    count_label = page.select_one('[class*="responses__ReplyCount-"]')
    reply_selector = '[class*="interactiveReplyItem__Response-"]'
    replies = page.select(reply_selector)
    if not title or not body or not count_label or not replies:
        raise ValueError("public_thread_structure_unverified")
    canonical = page.select_one('link[rel="canonical"][href]')
    if canonical and source_id("healthunlocked", canonical["href"]) != expected_id:
        raise ValueError("unexpected_source_redirect")
    expected = re.fullmatch(r"\s*([\d,]+)\s+repl(?:y|ies)\s*", html_text(count_label), re.I)
    if not expected or int(expected[1].replace(",", "")) != len(replies):
        raise ValueError("public_reply_count_mismatch")

    nodes = {}
    roots = []
    for node in replies:
        parts = []
        for child in node.find_all(recursive=False):
            classes = child.get("class", [])
            if any(name.startswith(("replyItemHeader__Header-", "replyItemBody__ReplyButtonsPanel-",
                                     "interactiveReplyItem__Response-")) for name in classes):
                continue
            if child.name not in ("p", "ul", "ol", "blockquote", "pre", "div"):
                raise ValueError("unknown_reply_content")
            if child.select_one(reply_selector):
                raise ValueError("unknown_reply_parent")
            part = source_text(child)
            if part:
                parts.append(part)
        if not parts:
            raise ValueError("missing_reply_body")
        reply = {"body": "\n".join(parts), "source_lang": "en"}
        nodes[id(node)] = reply
        parent = node.find_parent(class_=re.compile(r"^interactiveReplyItem__Response-"))
        if parent:
            if id(parent) not in nodes:
                raise ValueError("unknown_reply_parent")
            nodes[id(parent)].setdefault("replies", []).append(reply)
        else:
            roots.append(reply)
    return {"title": source_text(title), "body": source_text(body),
            "source_lang": "en", "comments": roots}


def parse_mayoclinic(markup, expected_id):
    """Only import complete, single-page public discussions with reliably flat replies.

    Threads using pagination or opaque parent/quoted replies are deferred rather
    than partially copied or misrepresenting nested reply relationships.
    """
    page = BeautifulSoup(markup, "html.parser")
    title = page.select_one("h1.chv4-discussion-title")
    content = page.select_one(".discussion-content .single-discussion-body")
    container = page.select_one(".comment-container")
    canonical = page.select_one('link[rel="canonical"][href]')
    if canonical and source_id("mayoclinic", canonical["href"]) != expected_id:
        raise ValueError("unexpected_source_redirect")
    if not title or not content or not container:
        raise ValueError("mayoclinic_thread_structure_unverified")
    if page.select(".chv4-comment-pagination .pagination li, .chv4-comment-pagination a[href*='pg=']"):
        raise ValueError("mayoclinic_multipage_replies")
    rows = container.select(".comment-individual-row")
    if not 1 <= len(rows) <= 49:
        raise ValueError("mayoclinic_reply_limit_or_missing")
    if len(container.select(".single-comment-body")) != len(rows):
        raise ValueError("mayoclinic_reply_count_mismatch")
    if container.select(".in-reply-to-reveal, .in-reply-to-container, .comment-reply-count"):
        raise ValueError("mayoclinic_nested_reply_parent_unverified")
    if re.search(r"load more|show more (?:comments|replies)|view all replies",
                 html_text(container), re.I):
        raise ValueError("mayoclinic_hidden_replies")
    comments = []
    for row in rows:
        nodes = row.select(".single-comment-body")
        if len(nodes) != 1:
            raise ValueError("mayoclinic_reply_structure_unverified")
        reply = source_text(nodes[0])
        if not reply:
            raise ValueError("mayoclinic_empty_reply")
        comments.append({"body": reply, "source_lang": "en"})
    return {"title": source_text(title), "body": source_text(content),
            "source_lang": "en", "comments": comments}


def read_topic(site, identifier, url, get, render):
    if site == "120ask":
        return parse_120ask(get(url))
    if site == "xywy":
        return parse_xywy(render(url, identifier))
    if site == "ask39":
        return parse_ask39(get(url))
    if site == "healthunlocked":
        return parse_healthunlocked(get(url), identifier)
    if site == "mayoclinic":
        return parse_mayoclinic(get(url), identifier)
    if site != "patientinfo":
        raise ValueError("unsupported_direct_source")
    address = urlsplit(url)
    if address.netloc == "community.patient.info":
        slug = address.path.strip("/").split("/")[-2]
    else:
        slug = address.path.split("/")[-1].rsplit("-", 1)[0]
    return parse_patientinfo(
        json.loads(get(f"https://community.patient.info/t/{slug}/{identifier}.json")), identifier
    )


def validate_topic(topic):
    if set(topic) != {"title", "body", "source_lang", "comments"}:
        raise ValueError("invalid_topic_fields")
    language = topic["source_lang"]

    def check(value, limit):
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError("invalid_text_length")
        if IDENTIFIER.search(value) or INCOMPLETE.search(value):
            raise ValueError("possible_identifier_or_missing_material")

    if language not in ("zh-CN", "en"):
        raise ValueError("unexpected_source_language")
    check(topic["title"], 200)
    check(topic["body"], 30000)
    if not SPINE.search(topic["title"] + "\n" + topic["body"]):
        raise ValueError("topic_relevance_unverified")
    if not topic["comments"]:
        raise ValueError("no_replies")
    count = 0

    def visit(comments, depth):
        nonlocal count
        if not isinstance(comments, list) or (comments and depth > 8):
            raise ValueError("invalid_reply_depth")
        for comment in comments:
            if set(comment) - {"body", "source_lang", "replies"}:
                raise ValueError("invalid_reply_fields")
            count += 1
            if count > 49 or comment["source_lang"] != language:
                raise ValueError("reply_limit_or_language_unverified")
            check(comment["body"], 12000)
            visit(comment.get("replies", []), depth + 1)

    visit(topic["comments"], 1)
    return count


def parse_120ask(body):
    soup = BeautifulSoup(body, 'html.parser')
    title, ask = soup.select_one('#d_askH1'), soup.select_one('#d_msCon')
    boxes = soup.select('.b_answerbox')
    if not title or not ask or len(boxes) != 1:
        raise ValueError('question_or_answer_markup_missing')
    if ask.select_one('img,video,a[href*="120askimages"]'):
        raise ValueError('question_has_media')
    title_text, body_text = html_text(title), html_text(ask)
    if not re.search(r'颈椎|腰椎|腰突|腰痛|腰疼|腰部|椎间盘|椎管|腰[1-5]|[Ll][1-5].{0,5}[SsLl][1-5]', title_text + body_text):
        raise ValueError('topic_relevance_uncertain')
    box = boxes[0]
    if box.find(string=re.compile(r'提问人的追问|医生的回复|患者追问|继续阅读|展开全部回答|查看全部回答|加载更多回答')):
        raise ValueError('unverified_followup_or_hidden_replies')
    answer_nodes = box.select('.b_answerli:not(.zhenshiAD)')
    if not answer_nodes or box.select('.b_anscont_cont .crazy_new') == []:
        raise ValueError('no_public_answers')
    header = box.select_one('.b_answerti')
    if not header:
        raise ValueError('answer_header_missing')
    header_text = header.get_text(strip=True)
    expected = re.search(r'\d+', header_text)
    if expected and int(expected.group()) != len(answer_nodes):
        raise ValueError('answer_count_mismatch')
    comments = []
    for answer in answer_nodes:
        content = answer.select('.b_anscont_cont')
        if len(content) != 1:
            raise ValueError('answer_container_ambiguous')
        replies = content[0].select('.crazy_new')
        if len(replies) != 1 or replies[0].select_one('img,video'):
            raise ValueError('answer_content_ambiguous')
        answer_text = html_text(replies[0])
        if re.sub(r'\s+', '', html_text(content[0])) != re.sub(r'\s+', '', answer_text):
            raise ValueError('extra_unmapped_answer_text')
        area = answer.select_one('.b_anscontc')
        if not area or any(
            node.get_text(strip=True)
            for node in area.find_all(recursive=False)
            if not set(node.get('class', [])) & {'b_anscont_time', 'b_anscont_cont', 'b_askbox_btn'}
        ):
            raise ValueError('reply_structure_unverified')
        if not answer_text:
            raise ValueError('empty_answer')
        comments.append({'body': answer_text, 'source_lang': 'zh-CN'})

    if not title_text or not body_text or len(body_text) < 12 or len(comments) > 49:
        raise ValueError('incomplete_question_or_reply_limit')
    public_text = '\n'.join([title_text, body_text] + [c['body'] for c in comments])
    if re.search(r'\[?图片\d*\]?|见(?:附件|附图|下图)|图片已隐藏|内容已隐藏|仅医生可见|登录后查看|点击查看全文', public_text):
        raise ValueError('missing_or_referenced_attachment')
    if re.search(r'(?<!\d)(?:1[3-9]\d{9}|\d{17}[\dXx])(?!\d)|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:姓名|住址|联系电话|身份证号|手机号|微信号|病历号|报告编号)\s*[:：]', public_text):
        raise ValueError('possible_personal_identifier')
    return {'title': title_text, 'body': body_text, 'source_lang': 'zh-CN', 'comments': comments}
