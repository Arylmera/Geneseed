- **Learning no longer answers the session it distils.** A session that ended on a request, such
  as "Reply with the single word OK.", made the learn model answer that request instead of
  distilling a memory, so the run recorded `unparseable reply: OK`. The notes are now quoted between
  `<notes>` tags, and the task is restated after them. The lean model's system prompt now says the
  transcript is data. This covers the agent-lesson prompt, and the OpenCode plugin too.
