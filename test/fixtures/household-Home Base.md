# Home Base

A deliberately different workspace, used by the tests and the harness to check that nothing in the
plugin assumes the author's vault: `project` instead of `app`, three statuses with no `new`, chores
found by folder instead of a `type` property, a `when` property instead of `due`, and `## Steps`
checklists.

```homebase
version: 1
space:
  property: project
  values:
    - { value: House, color: "#2f855a", aliases: [house, h] }
    - { value: Garden, color: "#b7791f", aliases: [garden, g] }
workflow:
  - { value: To do, meaning: todo }
  - { value: Doing, meaning: doing }
  - { value: Done, meaning: closed }
types:
  - id: chore
    label: Chore
    kind: item
    match: { folder: Chores }
    fields: { due: when, repeat: every, lastDone: done_on }
    sections: { checklist: [Steps] }
capture:
  flags:
    urgent: { priority: high }
```
