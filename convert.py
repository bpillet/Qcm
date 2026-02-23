#!/usr/bin/env python3
"""
convert.py  —  Org-mode → data.json for the Bayesian Quiz
Usage:  python convert.py quiz.org          (prints JSON to stdout)
        python convert.py quiz.org -o data.json   (writes to file)

Expected Org structure
──────────────────────
 ** <title>         <- topic title (** heading)

   <any preamble text>    <- ignored

 *** Question   :TF:
 :PROPERTIES:
 :CORRECT:  0              <- 0 = True  1 = False
 :END:

<question text  may span several paragraphs and contain LaTeX>

 **** Explanation
<explanation text>

 *** Question   :Mult:
 :PROPERTIES:
 :CORRECT:  2              <- 0-indexed position in the Answers list
 :END:

<question text>

 **** Answers
- <answer 0>
- <answer 1>
- <answer 2>

 **** Explanation
<explanation text>
 ** Another Topic                   <- next topic
...
"""

import re
import json
import sys
import argparse

# ── Helpers ───────────────────────────────────────────────────────────────────


# A ** topic heading (exactly two stars)
RE_TOPIC = re.compile(r'^\*{2} (.+)$', re.MULTILINE)

# Matches a *** Question heading with a tag (:TF: or :Mult:)
# Handles arbitrary whitespace between the heading text and the tag.
RE_QUESTION = re.compile(
    r'^\*{3} Question[^\n]*:(TF|Mult):[^\n]*$',
    re.MULTILINE
)

# Matches a **** sub-heading
RE_SUBHEADING = re.compile(r'^\*{4}\s+\S', re.MULTILINE)


def find_subheading(block, name):
    """
    Return a match for '**** <name>' inside block, or None.
    The match captures everything after the heading line until the next ****
    heading or end of block.
    """
    pattern = re.compile(
        r'^\*{4}\s+' + re.escape(name) + r'\s*\n'   # heading line
        r'(.*?)'                                      # content (group 1)
        r'(?=^\*{4}|\Z)',                             # until next **** or end
        re.MULTILINE | re.DOTALL
    )
    m = pattern.search(block)
    return m.group(1).strip() if m else None

# ── Parser ────────────────────────────────────────────────────────────────────

def parse_question(block, idx_for_warnings):
    """Parse a single *** Question block into a dict, or None on hard error."""
    tag_m = re.search(r':(TF|Mult):', block.splitlines()[0])
    tag   = tag_m.group(1) if tag_m else None
    if not tag:
        print(f"⚠️  Question {idx_for_warnings}: no :TF: or :Mult: tag — skipped.",
              file=sys.stderr)
        return None

    # :CORRECT:
    correct_m = re.search(r':CORRECT:\s*(\d+)', block)
    if not correct_m:
        print(f"⚠️  Question {idx_for_warnings}: no :CORRECT: — defaulting to 0.",
              file=sys.stderr)
    correct = int(correct_m.group(1)) if correct_m else 0

    # Question text: between :END: and first **** sub-heading
    end_prop_m  = re.search(r':END:', block)
    first_sub_m = RE_SUBHEADING.search(block)
    q_start = end_prop_m.end()    if end_prop_m  else 0
    q_end   = first_sub_m.start() if first_sub_m else len(block)
    question_text = block[q_start:q_end].strip()

    # Answers
    if tag == 'TF':
        answers = ["True", "False"]
    else:
        raw = find_subheading(block, 'Answers')
        if raw is None:
            print(f"⚠️  Question {idx_for_warnings}: no **** Answers sub-heading — skipped.",
                  file=sys.stderr)
            return None
        answers = [a.strip()
                   for a in re.findall(r'^\s*-\s+(.+)', raw, re.MULTILINE)]

    # Explanation
    explanation = find_subheading(block, 'Explanation') or ''

    return {
        "text":        question_text,
        "answers":     answers,
        "correct":     correct,
        "explanation": explanation,
    }


# ── Top-level parser ──────────────────────────────────────────────────────────

def parse(path):
    text = open(path, encoding='utf-8').read()

    topic_matches = list(RE_TOPIC.finditer(text))
    if not topic_matches:
        print("⚠️  No ** topic headings found.", file=sys.stderr)
        return []

    topics = []
    q_counter = 0

    for t_idx, t_m in enumerate(topic_matches):
        # Raw title: strip org tags like :noexport: and extra whitespace
        raw_title = t_m.group(1)
        title = re.sub(r'\s*:[A-Za-z_]+:\s*$', '', raw_title).strip()

        # Skip headings explicitly tagged :noexport:
        if ':noexport:' in raw_title.lower():
            continue

        # Text of this topic: from after its heading to before the next ** heading
        t_start = t_m.end()
        t_end   = topic_matches[t_idx + 1].start() \
                  if t_idx + 1 < len(topic_matches) else len(text)
        topic_block = text[t_start:t_end]

        # Find all *** Question blocks within this topic
        q_matches = list(RE_QUESTION.finditer(topic_block))
        questions = []

        for q_idx, q_m in enumerate(q_matches):
            q_counter += 1
            q_start = q_m.start()
            q_end   = q_matches[q_idx + 1].start() \
                      if q_idx + 1 < len(q_matches) else len(topic_block)
            q_block = topic_block[q_start:q_end]

            q = parse_question(q_block, q_counter)
            if q:
                questions.append(q)

        if questions:
            topics.append({"title": title, "questions": questions})
        else:
            print(f"⚠️  Topic '{title}' has no valid questions — omitted.",
                  file=sys.stderr)

    return topics

# ── CLI ───────────────────────────────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description='Convert Org-mode quiz to JSON')
    ap.add_argument('org_file',       help='Input .org file')
    ap.add_argument('-o', '--output', help='Output JSON file (default: stdout)')
    args = ap.parse_args()

    data = parse(args.org_file)
    n_q  = sum(len(t['questions']) for t in data)
    out  = json.dumps(data, indent=2, ensure_ascii=False)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(out)
        print(f"✓ Exported {len(data)} topic(s), {n_q} question(s) → {args.output}",
              file=sys.stderr)
    else:
        print(out)


if __name__ == '__main__':
    main()
