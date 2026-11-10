#!/usr/bin/env python3
"""Offline fastText LID helper for a bounded, read-only production audit.

Reads a JSON array of source texts from stdin and returns language guesses only.
Patient text, IDs, and sources must never be printed or persisted.
"""
import argparse
import json
import re
import sys


def classify(model, text):
    if not isinstance(text, str) or len(text) > 50000:
        raise ValueError("invalid source-text length")
    cleaned = " ".join(re.sub(r"https?://\S+|\b\S+@\S+\b", " ", text).split())
    letters = sum(ch.isalpha() for ch in cleaned)
    if letters < 16:
        return {"language": "und", "score": 0.0, "margin": 0.0, "letters": letters}
    names, probs = model.predict(cleaned[:12000], k=2)
    first = names[0].removeprefix("__label__") if names else "und"
    score = float(probs[0]) if len(probs) else 0.0
    second = float(probs[1]) if len(probs) > 1 else 0.0
    return {"language": first, "score": round(score, 5),
            "margin": round(score - second, 5), "letters": letters}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    import fasttext
    model = fasttext.load_model(args.model)
    if args.self_test:
        cases = [
            ("en", "I have suffered from lower back pain for several years and physical therapy helped."),
            ("es", "He tenido dolor lumbar durante muchos meses y los ejercicios suaves me ayudaron a mejorar."),
            ("fr", "Depuis plusieurs mois, je souffre du bas du dos et je suis des séances de kinésithérapie."),
        ]
        for expected, content in cases:
            observed = classify(model, content)["language"]
            if observed != expected:
                raise ValueError("fastText fixture failed for " + expected + ": " + observed)
        print("fastText offline fixtures passed")
        return
    data = json.load(sys.stdin)
    if not isinstance(data, list) or len(data) > 1000:
        raise ValueError("invalid bounded audit batch")
    results = [classify(model, item) for item in data]
    print(json.dumps(results, ensure_ascii=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not accidentally print patient text in exception messages.
        print("fastText local audit failed", file=sys.stderr)
        sys.exit(1)
