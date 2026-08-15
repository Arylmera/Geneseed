// A deterministic stand-in for whatever `$GENESEED_LLM` names — the Node twin of
// `tests/fixtures/fake_llm.py`, and one of the two Python files the CLI matrix still names
// from inside its own cell data.
//
// `learn` shells out to a model CLI of the user's choosing — `claude -p`, `llm`, `ollama run …`
// — as `llm.split() + [prompt]`. A real one is non-deterministic, needs credentials, and
// Geneseed never calls a paid API, so the harness supplies this instead. It is the LLM in the
// same sense the sandbox is a home directory.
//
// Driven entirely by environment, so one fixture serves every learn cell:
//
//     FAKE_LLM_OUT    file whose contents go to stdout (absent => empty stdout)
//     FAKE_LLM_ERR    literal text for stderr
//     FAKE_LLM_RC     exit code (default 0)
//     FAKE_LLM_ECHO   file to write the PROMPT into
//
// `FAKE_LLM_ECHO` is the load-bearing one. The prompt is most of what `learn` computes before
// it delegates — the head lifted out of the OpenCode plugin, the already-stored slug list, the
// 16k tail truncation — and none of it is observable in the emitted memory files. Echoing it
// into the sandbox turns the prompt into a compared artefact instead of an internal value.
//
// RAW BYTES, not a string write. A model CLI emits UTF-8 whatever the machine's code page is,
// and this fixture has to do the same unconditionally — writing through a text layer would make
// the reply's encoding follow the runtime's own mode, so the cell that runs with UTF-8 mode OFF
// (`learn/non-ascii-model-reply-without-utf8-mode`) would be testing this file's encoding rather
// than the reader's.
//
// `llm.split()` IS WHITESPACE-SPLIT, so the command this fixture is invoked through cannot
// contain a space. That is why the replayer substitutes the bare name `node` rather than
// `process.execPath`, which on Windows is `C:\Program Files\nodejs\node.exe`. A property of the
// interface being tested, not of this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// THE ECHO GOES THROUGH THE PLATFORM'S LINE SEPARATOR, and the reply below does not. That
// asymmetry is the reference's, reproduced deliberately: the echo is written with
// `Path.write_text` (text mode, so `\n` becomes `os.linesep`) while the reply is written to
// `sys.stdout.buffer` as raw bytes. Getting it wrong is invisible in a terminal and worth 37
// bytes per prompt against the `crlf` corpus — which is exactly what the first draft of this
// file cost, on every `learn` cell at once.
const echo = process.env.FAKE_LLM_ECHO;
if (echo) {
  fs.mkdirSync(path.dirname(echo), { recursive: true });
  const prompt = process.argv[2] ?? '';
  fs.writeFileSync(echo, Buffer.from(os.EOL === '\n' ? prompt : prompt.replaceAll('\n', os.EOL),
    'utf8'));
}

const src = process.env.FAKE_LLM_OUT;
if (src && fs.existsSync(src) && fs.statSync(src).isFile()) {
  fs.writeSync(1, fs.readFileSync(src));
}

const err = process.env.FAKE_LLM_ERR;
if (err) fs.writeSync(2, Buffer.from(err, 'utf8'));

process.exit(Number(process.env.FAKE_LLM_RC || 0) || 0);
