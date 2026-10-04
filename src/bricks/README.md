# Bricks

A brick is one node of a loop graph: a single prompt, handed to one agent or skill, that reports
back one of a declared set of outcomes. `geneseed loop next` reads the current node's brick and
hands its body to the model verbatim — the model never sees this file as a file, only as the
instructions inside it.

A brick is a markdown file, `<name>.md`, with flat YAML-ish frontmatter (`name`, `description`,
`effect`, exactly one of `agent` or `skill`, `outcomes`) and a plain-prose body. See
`_template.md` for the field-by-field shape.

## The three origins

A brick's name is looked up across three levels, each one able to override the level before it
by name:

| origin | path | who writes it |
|---|---|---|
| shipped | `src/bricks/` (this directory) | Geneseed itself |
| global | `$XDG_CONFIG_HOME/geneseed/bricks/` | the user, for every project on this machine |
| project | `<repo>/.geneseed/bricks/` | a team, committed and shared |

A global or project brick named `apply` replaces the shipped `apply` everywhere a loop template
references it — the template does not have to change, and `geneseed loop check` reports the
override rather than hiding it.

## Writing one

Start from `_template.md`, or ask the `brick-forge` skill to draft one for an agent or skill you
already have. Keep the body to 4-10 lines of direct instruction, and end it with how the model
should choose among the outcomes you declared — that sentence is what turns a vague brief into a
loop that actually terminates. If the brick finds something the next brick needs, write it to a
file in the OS temp directory and report that file's path with the outcome — the loop skill
records it as a note.
