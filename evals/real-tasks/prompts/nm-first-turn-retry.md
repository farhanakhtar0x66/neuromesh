When a run stops during a task's very first turn and is resumed, that first turn is sent again as a "continue" turn instead of as a first turn.

Seen in a real run: the Claude login was revoked during a worker's first turn; the user signed in again and resumed the run, and the turn went out as a continue turn. A continue turn has no confidence preamble (the "very first message" instruction every first turn carries), so the questions a first turn asks the developer (can you do this, does it need a design first) were never asked.

Expected: if a task's first turn stopped (a subscription limit, a revoked login, a cancel, the engine dying) before it changed anything in the task's working folder, the task's next turn is a first turn again: attempt kind "initial", with its preamble and without the "interrupted part way" wording. Only when the stopped turn left changes in the folder is the next turn a continue turn, as today. A stopped turn's session is not resumed in either case.

Tests: test/cascade.test.ts and test/engine.test.ts (the pause and resume tests, and the cancel test).
