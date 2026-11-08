"""Offline discovery tests: fixtures are synthetic URLs, not imported patient content."""
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from spine_discover import candidate_links, discover_candidates
from spine_sources import source_id, read_topic


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
            if "healthunlocked.com" in url:
                raise FetchProblem()
            return "<html><body></body></html>"

        with patch("spine_discover.time.sleep"):
            got = discover_candidates("healthunlocked", {}, fake_fetch,
                                      lambda event, **kw: events.append((event, kw)))
        self.assertEqual(got, {})
        self.assertEqual(len([x for x in calls if "healthunlocked.com" in x]), 1,
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


if __name__ == "__main__":
    unittest.main()
