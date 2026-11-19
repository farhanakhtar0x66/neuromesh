# Writing the Neuromesh paper: a guide for a first paper

For the owner, a first-year CS student writing a first research paper. The tests to run first are in `RESEARCH.md`;
this file is about turning their results into a paper and getting it out. Plain advice, in the order you will need it.

## 1. What a research paper is (and is not)

A paper makes **one main claim** and gives the evidence that it is true. Everything in it serves that claim: the
introduction says why it matters, the method says how you tested it, the results show the evidence, the discussion
says what it means and where it may be wrong.

It is not a project report. Nobody needs the history of Neuromesh, the TUI, or every feature. A reviewer reads 10
papers a week and asks three things: *Is the question worth asking? Is the evidence sound? Is it new?*

**Our claim (draft, to be confirmed by the test-set runs):**

> When a frontier coding model works with cheaper models, handing over facts keeps its resolution rate and handing
> over judgement loses it; on real repository issues a facts-only handoff matches the frontier model alone, and on
> building tasks routing by kind of work matches it at a quarter of the cost.

If the test-set runs say something different, the claim changes. That is normal and honest; a clean negative result
("this popular idea does not work, and here is why") is publishable too.

## 2. The order to do things in

1. **Run the tests** in `RESEARCH.md` (the test set, three repeats). Do not start writing results before they exist.
2. **Make the figures and tables first.** A paper is built around 3 to 5 figures or tables. Draft them from
   `evals/results/` before writing prose. If a figure does not support the claim, either the claim or the figure is
   wrong.
3. **Write the abstract** (150 to 250 words) as a test of whether you know what you are saying: problem, what you did,
   the main numbers, what it means.
4. **Write the sections** in this order: method, results, introduction, related work, discussion, conclusion,
   abstract again. The introduction is easier once you know exactly what the results are.
5. **Get feedback** from someone who has published (section 6) before submitting.

## 3. The structure, section by section

A short paper (workshop) is 4 to 6 pages; a full conference paper 8 to 10, plus references.

**Title.** Says the finding, not the project. "Facts, Not Judgement: What a Frontier Coding Agent Can Safely Hand to
Cheaper Models" says more than "Neuromesh: A Multi-Agent System".

**Abstract.** One paragraph: the problem (frontier models are expensive; multi-model systems promise savings), the
gap (it is not known what can be delegated without losing quality), what you did (controlled comparisons on real
GitHub issues and building tasks, with ablations), the numbers, the takeaway.

**1. Introduction** (about 1 page). The problem and why it matters (cost of coding agents, subscription limits).
What others assume (cheap models can plan, review or patch). Your question. Your contributions as a short list, for
example:
- a controlled study of five ways a frontier model can share work with cheaper models, on N real issues;
- the finding that judgement handoffs lose quality and fact handoffs do not, with ablations;
- a cost analysis showing agent cost is calls times context, and what reduces it;
- an open-source harness (Neuromesh, MIT) to reproduce it.

**2. Background and related work** (about 0.5 to 1 page). What exists and how yours differs: model cascades and
routers (FrugalGPT, RouteLLM and others), multi-agent coding systems, SWE-bench and SWE-bench-Live, context
management for agents (the observation-masking study, SWE-agent's interface design), and the papers already listed
in `docs/25-cascade-research.md`. For each, one or two sentences: what it did, and what it did not answer that you do.
Read the papers you cite; do not cite from a summary.

**3. Method** (1 to 2 pages). Enough for someone else to repeat it:
- the configurations (a diagram helps: who does what, what is handed over);
- the models and the CLI versions, effort settings, limits;
- the task sets: how the issues were chosen, the dev/test split, the contamination rule, the interface notes;
- the grading (the official harness, hidden tests);
- the metrics (resolved, estimated cost, calls, tokens re-read, window points) and the statistics (three runs,
  paired bootstrap, 90% intervals);
- what was frozen before the test runs.

**4. Results** (2 to 3 pages). One subsection per research question. Each opens with the answer in one sentence,
then the table or figure, then what in it supports the answer. Report what did not work as plainly as what did.

**5. Discussion.** Why the results come out this way (judgement depends on reading what the issue implies; the
handoff loses that). What it means for people building agents. **Threats to validity** (from `RESEARCH.md`): one
machine, one provider's quotas, estimated costs, possible contamination, not the leaderboard protocol.

**6. Conclusion.** Three to five sentences. No new information.

**References.** Every claim that is not yours has a citation. Use a reference manager (Zotero is free) and BibTeX.

## 4. Writing well

- **One idea per paragraph**, stated in its first sentence. Readers skim first sentences.
- **Numbers, not adjectives.** Not "much cheaper" but "at 25% of the estimated cost (90% interval 21 to 30%)".
- **Say what you measured, not what you hope.** "On 60 issues, three runs each" and "one run" where that is all there
  is.
- **Define every term once** and use the same word every time (do not switch between "dossier", "brief" and "report"
  for one thing).
- **Figures stand alone:** a caption says what is shown and what to notice.
- **Short sentences, plain words.** A clear paper is read and cited; a clever one is skipped.
- **Use LaTeX** with the venue's template. Overleaf (free) works in the browser and has every template.

## 5. Honesty rules that reviewers check

- **No tuning on the test set**, and say how the dev and test sets were separated.
- **Report every configuration you ran on the test set**, not only the ones that worked.
- **Repeats and intervals.** One run of an LLM agent is noisy; reviewers reject single-run claims.
- **Costs are estimates**; say how they were computed.
- **Disclose AI assistance.** Most venues and arXiv now ask authors to state how AI tools were used (for example, for
  code, analysis or writing help). You are responsible for every sentence and number; check each one against the
  data. Read the venue's policy before submitting.
- **Make it reproducible:** the code (MIT), the presets, the task lists and the raw results (`evals/results/`) in a
  public repository, linked from the paper.

## 6. Get a mentor

As a first-year student, the single most useful step is finding someone who has published in software engineering
or machine learning (a professor or a PhD student at your university) and asking them to read a draft. Many will, and
some will offer to co-author. Bring the results table and the one-paragraph claim, not the whole repository. Also
ask your university about undergraduate research programmes and funding for conference travel.

## 7. Where to submit

Deadlines change every year; check each venue's current "call for papers" page.

1. **arXiv preprint (first).** Free, public within days, gives the work a date and a citable link. Category:
   cs.SE (software engineering), cross-listed to cs.AI or cs.LG. **First-time submitters need an endorsement** from
   an established arXiv author in that category; a mentor can endorse you. Posting on arXiv does not stop you from
   submitting to most conferences, but check each venue's rules.
2. **Workshops** (good first venue: 4 to 8 pages, friendlier review, faster). Look for workshops on LLMs for code,
   AI agents, or efficient AI held with the big conferences: ICSE and FSE (software engineering), NeurIPS, ICML and
   ICLR (machine learning), ACL and EMNLP (language). Each conference lists its workshops some months before.
3. **Student research competitions.** ACM runs Student Research Competitions at ICSE, FSE and other conferences:
   short abstracts, a poster, and sometimes travel support. Built for undergraduates.
4. **Main conferences** (harder, 8 to 10 pages, acceptance often 20 to 30%): ICSE, FSE, ASE, ISSTA for software
   engineering; NeurIPS, ICLR, ICML for machine learning (some have dataset and benchmark tracks). Better as a second
   step, with a mentor.

Avoid "journals" or conferences that email you asking for papers and charge large fees: many are predatory. When
unsure, ask a mentor, or check that the venue is run by ACM, IEEE, USENIX or a well-known ML conference.

## 8. A realistic timeline

| Weeks | What |
| --- | --- |
| 1 to 2 | Import the test set; freeze the configurations; run 10 issues to measure the quota a run needs |
| 3 to 6 | The test-set runs (three repeats), across weekly windows |
| 6 to 7 | Tables and figures; read the lost issues; decide the final claim |
| 7 to 9 | Write the draft; mentor feedback |
| 9 to 10 | Revise; arXiv; pick a workshop or student competition with a deadline after that |

## 9. What Claude can help with, and what is yours

Claude can help run and check the tests, build tables and figures from the raw results, draft and edit sections,
check every number in the text against `evals/results/`, and find related work to read. The decisions are yours: the
claim, what goes in, what the results mean. You must be able to explain every sentence and figure to a reviewer or
in a talk, and the paper must say how AI tools were used.
