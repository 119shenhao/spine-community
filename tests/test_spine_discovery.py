"""Offline discovery tests: fixtures are synthetic URLs, not imported patient content."""
import sys
import unittest
from pathlib import Path
from urllib.parse import urlsplit
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from spine_discover import candidate_links, discover_candidates
from spine_sources import source_id, read_topic, parse_mayoclinic, parse_mayoclinic_pages, parse_mayoclinic_stage_page, parse_healthunlocked, parse_ask39, ask39_has_ad
from spine_collect import read_120ask_links, ask39_listing_candidates, ask39_directory_candidates, read_request


class DiscoveryTests(unittest.TestCase):
    def test_collect_all_expands_registry_and_future_sources(self):
        import json
        import tempfile
        from unittest.mock import patch
        from spine_collect import SOURCE_URLS
        def request(sites, candidates=None, mode="collect"):
            with tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / "request.json"
                path.write_text(json.dumps({
                    "request_id": "unified-collector-001",
                    "mode": mode, "sites": sites,
                    "candidates": {} if candidates is None else candidates,
                    "limit": 10,
                }), encoding="utf-8")
                return read_request(path)

        self.assertEqual(request(["all"])["sites"], list(SOURCE_URLS))
        self.assertEqual(request(["120ask"])["sites"], ["120ask"])
        with patch.dict(SOURCE_URLS, {"future_approved_site": ("example.test", "/posts/([0-9]+)") }):
            self.assertIn("future_approved_site", request(["all"])["sites"])
        for sites in (["all", "120ask"], ["all", "all"], ["not_registered"]):
            with self.subTest(sites=sites):
                with self.assertRaisesRegex(ValueError, "invalid_sites_or_limit"):
                    request(sites)
        with self.assertRaisesRegex(ValueError, "invalid_all_sites_request"):
            request(["all"], {"120ask": []})
        with self.assertRaisesRegex(ValueError, "invalid_all_sites_request"):
            request(["all"], mode="inspect")

    def test_unified_collector_runs_independent_per_site_quotas(self):
        import json
        import tempfile
        from urllib.parse import parse_qs
        from unittest.mock import patch
        import spine_collect

        for expected_per_site in (2, 0):
            with self.subTest(last_site_result=expected_per_site):
                with tempfile.TemporaryDirectory() as directory:
                    config = Path(directory) / "request.json"
                    # Intentionally omit limit: default is two for each source.
                    config.write_text(json.dumps({
                        "request_id": "collect-all-test",
                        "mode": "collect",
                        "sites": ["all"],
                        "candidates": {},
                    }), encoding="utf-8")
                    calls, events = [], []
                    def fake_api(path, payload=None):
                        if path.startswith("/api/collect/queue?"):
                            site = parse_qs(urlsplit(path).query)["site"][0]
                            return {"items": [{"source_id": "1",
                                               "url": "https://example.test/" + site}]}
                        return {"status": "queued"}
                    def fake_collect(site, candidates, limit, export_dir):
                        calls.append((site, limit))
                        result = expected_per_site if len(calls) == len(spine_collect.SOURCE_URLS) else 2
                        return True, result
                    def fake_emit(event, **data):
                        events.append((event, data))
                    with (patch("sys.argv", ["spine_collect.py", str(config)]),
                          patch("spine_collect.exclusions", return_value={}),
                          patch("spine_collect.api", side_effect=fake_api),
                          patch("spine_collect.discover_120ask", return_value={}),
                          patch("spine_collect.ask39_directory_candidates", return_value={}),
                          patch("spine_collect.discover_candidates", return_value={}),
                          patch("spine_collect.collect", side_effect=fake_collect),
                          patch("spine_collect.emit", side_effect=fake_emit)):
                        status = spine_collect.main()
                    self.assertEqual(status, 0)
                    self.assertEqual(calls, [(site, 2) for site in spine_collect.SOURCE_URLS],
                                     "each source must run even after earlier sites reach their own quota")
                    summary = [d for event, d in events if event == "run_summary"]
                    self.assertEqual(len(summary), 1)
                    data = summary[0]
                    self.assertEqual(data["requested_target"], 2 * len(spine_collect.SOURCE_URLS))
                    self.assertEqual(data["new_topics"], 2 * (len(spine_collect.SOURCE_URLS)-1) + expected_per_site)
                    self.assertEqual(data["target_met"], expected_per_site == 2)
                    self.assertEqual(data["partial_success"], expected_per_site == 0)
                    self.assertEqual(len(data["site_results"]), len(spine_collect.SOURCE_URLS))
                    self.assertEqual(len([e for e, _ in events if e == "site_target"]),
                                     len(spine_collect.SOURCE_URLS))

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
        self.assertEqual(set(result),{"111111","222222"},"short spine titles must not be discarded")
        self.assertEqual(set(ask39_listing_candidates("https://ask.39.net/browse/11760-1-1.html",html,{"111111":"completed"})),{"222222"})
        self.assertEqual(ask39_listing_candidates("https://ask.39.net/browse/11760-1-1.html",
            '<p class="question-ask-title"><a href="/question/444444.html">腰椎病加微信咨询</a></p>',{}),{})


    def test_ask39_preselects_new_candidates_beyond_rejected_top_sixty(self):
        import spine_collect
        # All 100 are valid spine-related titles; the previously highest ranked
        # 65 entries were rejected in earlier runs and MUST NOT consume slots.
        html = ''.join(
            '<p class="question-ask-title"><a href="/question/%d.html">腰椎疼痛术后康复</a></p>' % i
            for i in range(100000, 100100)
        )
        requests = []
        def check(path, payload=None):
            self.assertEqual(path, "/api/collect/queue")
            self.assertEqual(payload["action"], "check")
            self.assertEqual(payload["site"], "ask39")
            self.assertLessEqual(len(payload["items"]), 30)
            requests.append(payload)
            return {"site": "ask39", "status": "checked", "excluded": [
                {"source_id": row["source_id"], "status": "rejected"}
                for row in payload["items"] if int(row["source_id"]) < 100065
            ]}
        with (patch.object(spine_collect, "ASK39_LISTS", ("https://ask.39.net/browse/11760-1-1.html",)),
              patch.object(spine_collect, "fetch", return_value=html),
              patch.object(spine_collect, "api", side_effect=check),
              patch.object(spine_collect.time, "sleep"),
              patch.object(spine_collect, "emit")):
            results = ask39_directory_candidates({}, maximum=12)
        self.assertEqual(list(results), [str(i) for i in range(100065,100077)])
        self.assertEqual(len(requests), 3)
        self.assertEqual(sum(len(req["items"]) for req in requests), 90)

    def test_ask39_rejects_invalid_server_precheck(self):
        import spine_collect
        html = '<p class="question-ask-title"><a href="/question/123456.html">腰椎疼痛术后康复</a></p>'
        with (patch.object(spine_collect, "ASK39_LISTS", ()),
              patch.object(spine_collect, "fetch", return_value=html),
              patch.object(spine_collect, "api", return_value={"site":"other","status":"checked","excluded":[]}),
              patch.object(spine_collect.time, "sleep"),
              patch.object(spine_collect, "emit")):
            with self.assertRaisesRegex(ValueError,"invalid_candidate_precheck_response"):
                ask39_directory_candidates({})

    @staticmethod
    def ask39_sample(body, reply_texts=None, title="腰椎间盘突出怎么办"):
        if reply_texts is None:
            reply_texts = ["建议根据症状到医院复查"]
        replies = "".join(
            f'<div class="answer"><div class="doctor_all" id="reply_{i}"></div>'
            f'<p class="sele_txt">{reply}</p></div>'
            for i, reply in enumerate(reply_texts, start=100)
        )
        return (f'<h1 class="ask_tit">{title}</h1>'
                f'<div class="ask_hid"><div class="txt_ms">病情描述：{body}</div></div>'
                f'<div class="sele_all">{replies}</div>')

    def test_ask39_full_body_minimum_24_and_any_nonadvertising_reply(self):
        body = "腰椎间盘突出伴右腿麻木已经持续两个多月左右，坐久以后疼痛更明显，想知道接下来应该怎样治疗"
        self.assertGreaterEqual(len(body), 24)
        topic = parse_ask39(self.ask39_sample(body, ["先做检查"]))
        self.assertEqual(topic["body"], body)
        self.assertEqual(topic["comments"], [{"body": "先做检查", "source_lang": "zh-CN"}])
        # No requirement for 我、本人、术后 or other autobiographical cue words.
        with self.assertRaisesRegex(ValueError, "patient_narrative_too_short"):
            parse_ask39(self.ask39_sample("腰椎疼痛，怎么办"))
        with self.assertRaisesRegex(ValueError, "no_nonadvertising_replies"):
            parse_ask39(self.ask39_sample(body, []))

    def test_ask39_ad_filter_rejects_topic_and_removes_promotional_replies(self):
        body = "腰椎间盘突出伴右腿麻木已经持续两个月，久坐以后疼痛特别明显，需要如何治疗和恢复"
        self.assertTrue(ask39_has_ad("腰椎治疗加微信咨询优惠"))
        self.assertTrue(ask39_has_ad("扫码领取限时优惠的康复方案"))
        self.assertFalse(ask39_has_ad("我买过腰靠，但康复效果不太理想"))
        with self.assertRaisesRegex(ValueError, "advertising_in_topic"):
            parse_ask39(self.ask39_sample(body, title="腰椎治疗加微信咨询优惠"))
        with self.assertRaisesRegex(ValueError, "advertising_in_topic"):
            parse_ask39(self.ask39_sample(body + " 加微信咨询领取康复方案"))
        source = self.ask39_sample(body, ["添加微信咨询可以获得优惠套餐", "建议做核磁共振检查再评估"])
        topic = parse_ask39(source)
        self.assertEqual([r["body"] for r in topic["comments"]], ["建议做核磁共振检查再评估"])
        with self.assertRaisesRegex(ValueError, "no_nonadvertising_replies"):
            parse_ask39(self.ask39_sample(body, ["添加微信咨询领取优惠套餐"]))

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
        # A page-1 reply referring to a page-2 parent is not a valid chronology.
        forward = p1.replace('<div class="single-comment-body"><p>First reply.</p></div>',
             '<div class="in-reply-to-container"><a href="https://connect.mayoclinic.org/comment/112/">Parent</a></div><div class="single-comment-body"><p>First reply.</p></div>')
        with self.assertRaisesRegex(ValueError, "mayoclinic_reply_parent_order_unverified"):
            parse_mayoclinic_pages([forward,p2], "lumbar-recovery")

    def test_mayo_stage_page_ids_and_quote_are_not_duplicated(self):
        head = """<link rel="canonical" href="https://connect.mayoclinic.org/discussion/my-lumbar-story/">
        <h1 class="chv4-discussion-title">Lumbar fusion experience</h1>
        <div class="discussion-content"><div class="single-discussion-body">My recovery diary.</div></div>"""
        first = head + """<div class="comment-container"><div class="comment-individual-row" id="comment-111">
          <div class="single-comment-body">First reply.</div></div></div>
          <div class="chv4-comment-pagination page-1"><a href="?pg=2">2</a></div>"""
        second = head + """<div class="comment-container"><div class="comment-individual-row" id="comment-112">
          <div class="in-reply-to-container">
            <a href="https://connect.mayoclinic.org/comment/111/">Earlier reply</a>
            <div class="single-comment-body">Quoted old text not an extra reply.</div>
          </div>
          <div class="single-comment-body">Actual second reply.</div>
        </div></div><div class="chv4-comment-pagination page-2"><a href="?pg=2">2</a></div>"""
        one = parse_mayoclinic_stage_page(first, "my-lumbar-story", 1, 2)
        two = parse_mayoclinic_stage_page(second, "my-lumbar-story", 2, 2)
        self.assertEqual(one["comments"][0]["source_comment_id"], "111")
        self.assertIsNone(one["comments"][0]["parent_source_comment_id"])
        self.assertEqual(two["comments"], [{
            "source_comment_id": "112", "parent_source_comment_id": "111",
            "body": "Actual second reply.", "source_lang": "en"}])
        with self.assertRaisesRegex(ValueError, "mayoclinic_pagination_changed"):
            parse_mayoclinic_stage_page(first, "my-lumbar-story", 1, 3)
        with self.assertRaisesRegex(ValueError, "mayoclinic_page_order_unverified"):
            parse_mayoclinic_stage_page(second, "my-lumbar-story", 1, 2)
        with self.assertRaisesRegex(ValueError, "uncollected_media"):
            parse_mayoclinic_stage_page(second.replace("Actual second reply.", "<img src='/image.png'>"), "my-lumbar-story", 2, 2)

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
