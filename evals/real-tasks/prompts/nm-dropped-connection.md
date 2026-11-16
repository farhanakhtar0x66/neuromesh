A worker turn that ends because the connection dropped fails the whole run. For example the model tool ends with a turn whose stop reason is "error" and whose detail is "The stream was interrupted. Please continue the task you were working on." Nothing was wrong with the task, and a second attempt would normally work.

Expected: a turn that ends this way is retried once, automatically. If the retry succeeds the run goes on as if nothing had happened (in the test: the run finishes after exactly two model calls).

The engine is in src/engine/run.ts; the test is in test/engine.test.ts.
