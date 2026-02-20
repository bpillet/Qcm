#!/usr/bin/env python3
"""
convert.py  —  Org-mode → data.json for the Bayesian Quiz
Usage:  python convert.py quiz.org          (prints JSON to stdout)
        python convert.py quiz.org -o data.json   (writes to file)

Expected Org structure
──────────────────────
** MCQ : <title>          <- optional, ignored
   <any preamble text>    <- ignored

*** Question   :TF:
:PROPERTIES:
:CORRECT:  0              <- 0 = True, 1 = False
:END:

<question text, may span several paragraphs and contain LaTeX>

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
"""

import re
import json
import sys
import argparse

# ── Helpers ───────────────────────────────────────────────────────────────────

# Matches a *** Question heading with a tag (:TF: or :Mult:)
# Handles arbitrary whitespace between the heading text and the tag.
RE_QUESTION = re.compile(
    r'^\*{3} Question[^\n]*:(TF|Mult):[^\n]*$',
    re.MULTILINE
)

# Matches a **** sub-heading
RE_SUBHEADING = re.compile(r'^\*{4}\s+\S', re.MULTILINE)

def between(text, start_m, end_m=None):
    """Return the text between end-of-match start_m and start-of-match end_m."""
    start = start_m.end()
    end   = end_m.start() if end_m else len(text)
    return text[start:end].strip()


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
    return pattern.search(block)

# ── Parser ────────────────────────────────────────────────────────────────────

def parse(path):
    text = open(path, encoding='utf-8').read()

    questions = []
    q_matches = list(RE_QUESTION.finditer(text))

    if not q_matches:
        print("⚠️  No questions found. Check that headings use *** and tags :TF: or :Mult:",
              file=sys.stderr)
        return []

    for idx, m in enumerate(q_matches):
        tag   = m.group(1)          # 'TF' or 'Mult'
        start = m.start()
        end   = q_matches[idx + 1].start() if idx + 1 < len(q_matches) else len(text)
        block = text[start:end]

        # ── CORRECT index ─────────────────────────────────────────────────────
        correct_m = re.search(r':CORRECT:\s*(\d+)', block)
        if not correct_m:
            print(f"⚠️  No :CORRECT: property in question {idx + 1}, defaulting to 0.",
                  file=sys.stderr)
        correct = int(correct_m.group(1)) if correct_m else 0

        # ── Question text: between :END: and the first **** sub-heading ───────
        end_prop_m   = re.search(r':END:', block)
        first_sub_m  = RE_SUBHEADING.search(block)

        q_start = end_prop_m.end()   if end_prop_m  else m.end()
        q_end   = first_sub_m.start() if first_sub_m else len(block)

        question_text = block[q_start:q_end].strip()

        # ── Answers ───────────────────────────────────────────────────────────
        if tag == 'TF':
            answers = ["True", "False"]

        else:   # :Mult:
            answers_m = find_subheading(block, 'Answers')
            if not answers_m:
                print(f"⚠️  No **** Answers sub-heading in Mult question {idx + 1}.",
                      file=sys.stderr)
                answers = []
            else:
                # Bullet items: lines starting with optional spaces then "- "
                answers = re.findall(r'^\s*-\s+(.+)', answers_m.group(1), re.MULTILINE)
                answers = [a.strip() for a in answers]

        # ── Explanation ───────────────────────────────────────────────────────
        expl_m = find_subheading(block, 'Explanation')
        explanation = expl_m.group(1).strip() if expl_m else ''

        questions.append({
            "text":        question_text,
            "answers":     answers,
            "correct":     correct,
            "explanation": explanation,
        })

    return questions

# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description='Convert Org-mode quiz to JSON')
    ap.add_argument('org_file',       help='Input .org file')
    ap.add_argument('-o', '--output', help='Output JSON file (default: stdout)')
    args = ap.parse_args()

    data = parse(args.org_file)
    out  = json.dumps(data, indent=2, ensure_ascii=False)

    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(out)
        print(f"✓ Exported {len(data)} question(s) to {args.output}", file=sys.stderr)
    else:
        print(out)


if __name__ == '__main__':
    main()
