"""Offline discovery tests: fixtures are synthetic URLs, not imported patient content."""
import sys
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from spine_discover import candidate_links, discover_candidates
from spine_sources import source_id, read_topic, parse_mayoclinic, parse_mayoclinic_pages, parse_healthunlocked
from spine_collect import read_120ask_links, ask39_listing_candidates


class DiscoveryTests(unittest.TestCase):
    def test_legacy_and_modern_patient_ids(self):
        self.assertEqual(source_id("patientinfo",
            "https://community.patient.info/t/lumbar-spine-fusion/621432"), "621432")
        self.assertEqual(source_id("patientinfo",
            "https://patient.info/forums/discuss/lumbar-spine-fusion-621432"), "621432")
        with self.assertRaises(ValueError):
            source_id("patientinfo", "https://evil.example/t/lumbar-spine-fusion/621432")
        with self.assertRaises(ValueError):
            source_id("patientinfo", "https://community.patient.info/t/lumbar-spine-fusion/621432?track=1")

    def test_native_patient_list_filters_spine_and_exclusions(self):
        html = """<a href="/t/lumbar-spine-fusion/621432">Lumbar spine fusion recovery</a>
          <a href="/t/cervical-fusion/621433">Cervical fusion after surgery</a>
          <a href="/t/finger-injury/621434">Finger injury</a>"""
        url = "https://community.patient.info/c/bones-joints-and-muscles/2"
        got = candidate_links("patientinfo", url, html, {"621432": "completed"})
        self.assertEqual(list(got), ["621433"])

    def test_patient_tag_allows_short_spinal_context_title(self):
        html = '<a href="/t/need-help/621435">Need help</a>'
        got = candidate_links("patientinfo", "https://community.patient.info/tag/spinal-problems/369", html, {})
        self.assertEqual(list(got), ["621435"])

    def test_other_public_source_candidates(self):
        samples = [
            ("xywy", "https://club.xywy.com/", "https://club.xywy.com/wenda/199999.htm", "腰椎术后康复", "199999"),
            ("healthunlocked", "https://healthunlocked.com/tag/spinal-stenosis", "https://healthunlocked.com/my-community/posts/123456789/spinal-stenosis", "Spinal stenosis recovery", "123456789"),
            ("mayoclinic", "https://connect.mayoclinic.org/group/spine-health/", "https://connect.mayoclinic.org/discussion/lumbar-fusion/", "Lumbar fusion recovery", "lumbar-fusion"),
        ]
        for site, listing, url, title, ident in samples:
            with self.subTest(site=site):
                markup = '<a href="' + url + '">' + title + '</a>'
                self.assertEqual(list(candidate_links(site, listing, markup, {})), [ident])
                self.assertFalse(candidate_links(site, listing, markup, {ident: "completed"}))

    def test_rate_and_host_denial(self):
        class FetchProblem(Exception):
            def __init__(self):
                super().__init__("http_403")
                self.status = 403

        calls = []
        events = []
        def fake_fetch(url):
            calls.append(url)
            if urlsplit(url).hostname == "healthunlocked.com":
                raise FetchProblem()
            return "<html><body></body></html>"

        with patch("spine_discover.time.sleep"):
            got = discover_candidates("healthunlocked", {}, fake_fetch,
                                      lambda event, **kw: events.append((event, kw)))
        self.assertEqual(got, {})
        self.assertEqual(len([x for x in calls if urlsplit(x).hostname == "healthunlocked.com"]), 1,
                         "do not retry forbidden host")
        self.assertTrue(any(e == "discovery_unavailable" for e, _ in events))

    def test_patientinfo_read_topic_resolves_current_slug(self):
        seen = []
        record = {"id": 621432, "title": "Lumbar surgery recovery",
                  "posts_count": 3, "post_stream": {"stream": [1,2,3], "posts": [
                      {"id": 1, "post_number": 1, "cooked": "<p>My lumbar surgery</p>"},
                      {"id": 2, "post_number": 2, "cooked": "<p>Recovery</p>"},
                      {"id": 3, "post_number": 3, "cooked": "<p>Follow up</p>"},
                  ]}}
        def fake_get(url):
            import json
            seen.append(url)
            return json.dumps(record).encode()
        topic = read_topic("patientinfo", "621432",
                           "https://community.patient.info/t/lumbar-surgery-recovery/621432",
                           fake_get, lambda *_: None)
        self.assertEqual(topic["title"], "Lumbar surgery recovery")
        self.assertEqual(len(topic["comments"]), 2)
        self.assertEqual(seen, ["https://community.patient.info/t/lumbar-surgery-recovery/621432.json"])



    def test_mayo_public_flat_thread_and_incomplete_threads(self):
        html = """<link rel="canonical" href="https://connect.mayoclinic.org/discussion/spinal-surgery-recovery/">
          <h1 class="chv4-discussion-title">Spinal surgery recovery</h1>
          <div class="discussion-content"><div class="single-discussion-body"><p>My back is healing after surgery</p></div></div>
          <div class="comment-container">
            <div class="comment-individual-row"><div class="single-comment-body"><p>I experienced recovery too.</p></div></div>
            <div class="comment-individual-row"><div class="single-comment-body"><p>Thanks for your updates.</p></div></div>
          </div>"""
        html = html.replace('<div class="comment-individual-row">', '<div class="comment-individual-row" id="comment-111">', 1)
        html = html.replace('<div class="comment-individual-row">', '<div class="comment-individual-row" id="comment-112">', 1)
        topic = parse_mayoclinic(html, "spinal-surgery-recovery")
        self.assertEqual(len(topic["comments"]), 2)
        self.assertEqual(topic["source_lang"], "en")
        with self.assertRaisesRegex(ValueError, "mayoclinic_pagination_changed"):
            parse_mayoclinic(html + '<div class="chv4-comment-pagination page-1"><a href="?pg=2">2</a></div>', "spinal-surgery-recovery")
        with self.assertRaisesRegex(ValueError, "mayoclinic_parent_id_unverified"):
            parse_mayoclinic(html.replace('<div class="single-comment-body"><p>Thanks for your updates.</p></div>', '<div class="in-reply-to-container"></div><div class="single-comment-body"><p>Thanks for your updates.</p></div>'), "spinal-surgery-recovery")
        with self.assertRaisesRegex(ValueError, "unexpected_source_redirect"):
            parse_mayoclinic(html, "another-spinal-surgery")

    def test_120ask_discovery_prefers_topic_titles_not_doctor_specialties(self):
        html = """<a href="https://www.120ask.com/question/92345678.htm">颈椎术后一直头晕如何恢复</a>
          <a href="/question/92345679.htm">腰椎间盘突出后腿麻痛怎么办</a>
          <a href="https://www.120ask.com/question/92345680.htm">脚踝韧带损伤</a>
          <a href="https://bing.com/ck?url=https%3A%2F%2Fwww.120ask.com%2Fquestion%2F92345681.htm">腰椎病是否需要复查</a>"""
        result = read_120ask_links(html,"https://www.120ask.com/",{})
        self.assertEqual(set(result),{"92345678","92345679","92345681"})
        self.assertEqual(set(read_120ask_links(html,"https://www.120ask.com/",{"92345678":"completed"})),
                         {"92345679","92345681"})

    def test_ask39_question_previews_not_doctor_answer_links(self):
        rich = "我腰椎间盘突出三年，术后还在康复训练，最近坐着的时候大腿麻痛，去年还做过核磁共振检查，想咨询能否进一步康复"
        shallow = "医生你好腰椎"
        html = f"""<div class="question-ask">
          <p class="question-ask-title"><a href="/question/111111.html">我做腰椎间盘突出手术三个月后仍然腿麻，坐着加重，需要复查吗？</a></p>
          <p class="question-ask-content">{rich}</p></div>
          <div class="question-answer"><p class="question-answer-content">
            <a href="/question/111111.html">医生回复</a></p></div>
          <div class="question-ask"><p class="question-ask-title">
             <a href="/question/222222.html">腰椎疼怎么办</a></p>
             <p class="question-ask-content">{shallow}</p></div>
          <div class="question-ask"><p class="question-ask-title">
             <a href="/question/333333.html">今天眼睛痒怎么办</a></p>
             <p class="question-ask-content">我最近眼睛很干，非常不舒服，睡眠质量也不是很好，想知道怎么处理，需要做眼科检查吗</p></div>"""
        result = ask39_listing_candidates("https://ask.39.net/browse/11760-1-1.html",html,{})
        self.assertEqual(list(result),["111111"])
        self.assertEqual(ask39_listing_candidates("https://ask.39.net/browse/11760-1-1.html",html,{"111111":"completed"}),{})

    def test_mayo_cross_page_reply_parent_is_preserved_and_no_quote_duplication(self):
        head = """<link rel="canonical" href="https://connect.mayoclinic.org/discussion/lumbar-recovery/">
          <h1 class="chv4-discussion-title">Lumbar recovery</h1>
          <div class="discussion-content"><div class="single-discussion-body"><p>I am recovering from surgery.</p></div></div>"""
        p1 = head + """<div class="comment-container">
           <div class="comment-individual-row" id="comment-111">
             <div class="single-comment-body"><p>First reply.</p></div></div></div>
           <div class="chv4-comment-pagination page-1"><a href="?pg=2">2</a></div>"""
        p2 = head + """<div class="comment-container">
           <div class="comment-individual-row" id="comment-112">
             <div class="in-reply-to-container">
               <a href="https://connect.mayoclinic.org/comment/111/">Earlier response</a>
               <div class="single-comment-body"><p>Quoted reply not a separate message.</p></div>
             </div>
             <div class="single-comment-body"><p>Second reply.</p></div>
           </div></div>
           <div class="chv4-comment-pagination page-2"><a href="?pg=2">2</a></div>"""
        topic = parse_mayoclinic_pages([p1,p2], "lumbar-recovery")
        self.assertEqual(len(topic["comments"]),1)
        self.assertEqual(topic["comments"][0]["body"],"First reply.")
        self.assertEqual(topic["comments"][0]["replies"][0]["body"],"Second reply.")
        with self.assertRaisesRegex(ValueError,"mayoclinic_pagination_changed"):
            parse_mayoclinic_pages([p1,p2.replace('pg=2','pg=3')], "lumbar-recovery")
        with self.assertRaisesRegex(ValueError,"mayoclinic_page_limit"):
            parse_mayoclinic_pages([p1]*6, "lumbar-recovery")
        forward = p1.replace('id="comment-111"', 'id="comment-112"')
        backward = p2.replace('id="comment-112"', 'id="comment-111"').replace('comment/111/', 'comment/112/')
        with self.assertRaisesRegex(ValueError, "mayoclinic_reply_parent_order_unverified"):
            parse_mayoclinic_pages([forward,backward], "lumbar-recovery")

    def test_healthunlocked_public_nested_reply_structure(self):
        html = """<link rel="canonical" href="https://healthunlocked.com/painconcern/posts/153318229/spinal-decompression-surgery-on-saturday">
          <h1 id="js-post-heading">Spinal decompression surgery</h1>
          <div class="js-post-body"><p>I had surgery last weekend.</p></div>
          <div class="responses__ReplyCount-sc-123">2 replies</div>
          <div class="interactiveReplyItem__Response-sc-123">
            <div class="replyItemHeader__Header-sc-123">Author</div>
            <p>I had a similar experience.</p>
            <div class="interactiveReplyItem__Response-sc-123">
              <div class="replyItemHeader__Header-sc-123">Reply author</div>
              <p>Thank you for replying.</p>
            </div>
          </div>"""
        topic = parse_healthunlocked(html, "153318229")
        self.assertEqual(len(topic["comments"]), 1)
        self.assertEqual(len(topic["comments"][0]["replies"]), 1)
        with self.assertRaisesRegex(ValueError, "public_reply_count_mismatch"):
            parse_healthunlocked(html.replace("2 replies","3 replies"), "153318229")


if __name__ == "__main__":
    unittest.main()
