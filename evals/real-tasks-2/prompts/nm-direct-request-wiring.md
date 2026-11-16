The F109 one-answer worker (a small, self-contained request is answered by one call with no tools; see `directWorker` in `src/engine/run.ts` and `selfContained` in `src/routing/selfcontained.ts`) never fired in the first live benchmark runs: there was no `task.direct` event in any of the seven tasks it was meant for, although their requests were small and self-contained.

In a run on a near-empty project, the engine's prompt is the user's request with the brief's working standards appended (a 44-word request became 182 words and gained the word "install"), and the self-contained check was given that longer text, so it judged the request as not self-contained. Fix it: the check must judge the user's own request, not the engine's prompt with the standards in it. The run state holds the user's own words separately from the engine's prompt. The prompt the model is given must stay as it is.

After the fix, a request such as "write a python function that parses a duration like 1h30m into seconds. Write it to duration.py" in a greenfield project is routed to the worker tier and built with one no-tools call (a `task.direct` event tagged `feature: "F109"`), while the run's `prompt` is still the long one.

Graded by new tests in `test/cascade.test.ts` (not in your copy of the repository).
