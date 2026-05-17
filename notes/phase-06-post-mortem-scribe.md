# Phase 6 — Post-Mortem Scribe

> **Status:** Complete — full markdown report generated and saved to disk after every resolved incident.
>
> **Duration:** 1 session
>
> **Deliverable:** A Post-Mortem Scribe agent reads the complete incident history from state
> and generates a structured markdown report — timeline, root cause, impact, resolution,
> prevention steps, and lessons learned. Saved to `data/post-mortems/{incident_id}.md`
> and returned in the API response.

---

## 1. WHY this phase exists

An incident isn't over when the service is healed. Real SRE practice requires a post-mortem:
a written record of what happened, why, how it was fixed, and what to do to prevent it from
happening again. Without this, teams fix the same incidents repeatedly.

Sentinel's post-mortem is generated automatically from everything already in state — no
manual writing required. The Scribe reads the full incident history (all notes, all findings,
root cause, human decision, executor result) and produces a report that a non-technical
manager can read in the `executive_summary` and an engineer can act on via `prevention_steps`.

---

## 2. WHAT we built — file by file

```
src/sentinel/agents/
├── scribe.py          ← NEW: post_mortem_node, _to_markdown helper
├── graph.py           ← UPDATED: finalize → post_mortem → END
│                                  (post_mortem node added)
└── state.py           ← UPDATED: PostMortemReport model, post_mortem field

src/sentinel/api/
└── incidents.py       ← UPDATED: post_mortem field in response

data/post-mortems/     ← NEW: markdown files saved here per incident
```

---

## 3. HOW it works — concept by concept

### 3a. Two-step generation: structured → markdown

The Scribe uses the same pattern as every other agent: Gemini with structured output.
But the output isn't stored as a Pydantic model in state — it's converted to a markdown
string first, then stored.

**Step 1 — Gemini fills in `PostMortemReport` (structured data):**
```python
_scribe_llm = _llm.with_structured_output(PostMortemReport)
raw: PostMortemReport = await _scribe_llm.ainvoke([...])
```

**Step 2 — `_to_markdown()` converts it to a formatted string:**
```python
markdown = _to_markdown(raw, incident_id, service, severity)
return {"post_mortem": markdown}
```

Why structured output first instead of asking Gemini to write markdown directly?
Because structured output is reliable — you always get the right fields. If you ask for
markdown directly, Gemini might format it inconsistently or miss sections. The Pydantic
model enforces completeness; the formatter handles presentation.

### 3b. `_to_markdown()` — just Python string formatting

No template library. Three patterns:

```python
# list → bullet points
timeline_md = "\n".join(f"- {item}" for item in report.timeline)

# list → numbered list
prevention_md = "\n".join(f"{i+1}. {s}" for i, s in enumerate(report.prevention_steps))

# everything assembled in a triple-quoted f-string
return f"""# {report.title}
...
## Timeline
{timeline_md}
...
"""
```

`enumerate(list)` gives `(0, item), (1, item), ...` — `i+1` makes it 1-based.
Triple-quoted f-strings handle multi-line strings with variable substitution.

### 3c. Saving to disk from a node

```python
out_dir = Path("data/post-mortems")
out_dir.mkdir(parents=True, exist_ok=True)          # create dir if missing
(out_dir / f"{incident_id}.md").write_text(markdown, encoding="utf-8")
```

`pathlib.Path` is the modern Python way to handle file paths — cross-platform,
chainable with `/` operator. `mkdir(parents=True, exist_ok=True)` creates the full
directory tree without erroring if it already exists.

### 3d. Where it sits in the graph

Post-mortem runs after `finalize` in ALL cases — approved AND rejected:

```
human_approval → executor → finalize → post_mortem → END
human_approval → finalize (rejected) → post_mortem → END
```

Changed `finalize → END` to `finalize → post_mortem → post_mortem → END`.
The report is always written, even if the human rejected the fix. A rejected incident
is still an incident worth documenting.

### 3e. What the Scribe reads from state

| State field | Used for |
|---|---|
| `notes` | Timeline — chronological list of agent actions with timestamps |
| `triager_findings` | Failure category and initial classification |
| `investigator_findings` | Evidence and confidence per investigator |
| `root_cause_findings` | Root cause, contributing factors, recommended fix |
| `critique` | Whether the root cause was approved and why |
| `human_decision` | Whether the human approved or rejected the fix |
| `input.severity` | Severity label in the report header |

The Scribe is the only agent that reads the ENTIRE state. All other agents read a narrow
slice. The Scribe's job is synthesis — it's reading everything to write the complete story.

---

## 4. Full graph after Phase 6

```
START → triager → [log_detective, metric_analyst, topology_mapper]
                           ↓ (converge)
                   root_cause_analyst ←──── (loop back on rejection)
                           ↓
                         critic
                           ↓
                   after_critic_routing
                           ↓ (approved/max revisions)
                   human_approval  ← GRAPH PAUSES (interrupt())
                           ↓ (resume with Command)
                   after_human_routing
                    ↙              ↘
               executor          finalize  (rejected)
                   ↓                ↓
               finalize        post_mortem
                   ↓                ↓
               post_mortem         END
                   ↓
                  END
```

---

## 5. Interview questions this phase prepares you for

**Q: Why use structured output then convert to markdown, instead of asking the LLM for markdown directly?**
> Structured output (Pydantic) guarantees all required fields are present and correctly typed.
> Asking for markdown directly risks inconsistent formatting, missing sections, or hallucinated
> structure. Separate the LLM's reasoning job (fill in fields) from the presentation job
> (format as markdown). This pattern makes the output reliable and testable.

**Q: How do you write files from a LangGraph node?**
> A node is just an async Python function — you can do anything Python can do, including
> file I/O. Use `pathlib.Path` for cross-platform path handling. The node returns its state
> update dict as normal; the file write is a side effect.

**Q: When should a post-mortem be written — only for resolved incidents?**
> No — also for rejected or unresolved incidents. A rejected fix still represents an incident
> that happened, evidence that was gathered, and decisions that were made. Documenting it
> prevents the same investigation from being repeated next time.

---

## 6. Key commands

```bash
# Run full pipeline (inject → trigger → approve)
Invoke-RestMethod -Uri "http://localhost:8000/lab/services/api-gateway/inject" -Method POST -ContentType "application/json" -Body '{"mode":"crash_loop"}'

Invoke-RestMethod -Uri "http://localhost:8000/incidents" -Method POST -ContentType "application/json" -Body '{"alert_id":"test-phase6","service":"api-gateway","message":"Service is crash-looping","severity":"critical"}' | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "http://localhost:8000/incidents/INCIDENT_ID/approve" -Method POST -ContentType "application/json" -Body '{"approved":true}' | ConvertTo-Json -Depth 5

# Check saved post-mortem
cat data/post-mortems/INCIDENT_ID.md
```
