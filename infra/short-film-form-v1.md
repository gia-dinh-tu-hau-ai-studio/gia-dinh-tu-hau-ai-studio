# SHORT_FILM_FORM_V1 persistence and rollout

SHORT_FILM_FORM_V1 follows the existing Google Sheets + Google Drive architecture.
It does not introduce a destructive database migration.

## Persistence

- `PROJECTS!Y` remains the canonical `contract_json` column.
- The optional `short_film_workflow` object is versioned with
  `schema_version: SHORT_FILM_FORM_V1`.
- `PROJECTS!T` stores the derived `next_action`; clients cannot bypass gates by
  submitting a separate `production_allowed` flag.
- Every workflow write appends `SHORT_FILM_WORKFLOW_UPDATED` to `AUDIT_LOG`.
- Existing rows without `short_film_workflow` remain readable and unchanged.

## Drive layout

New SHORT_FILM projects receive additive folders: contract, character, script,
shot plan, pilot, film production, final QC, and publishing. MUSIC_VIDEO folder
creation is unchanged. No existing folder or Character Master asset is renamed,
moved, overwritten, or deleted.

## Identity readiness

The temporary source list is Tường Vy and Phương An. CHARACTER_LIBRARY entries
replace this fallback only when `visual_identity_json` declares
`master_identity_status=APPROVED` and `lock_status=LOCKED`. The existing eligible
character API remains backward compatible and now exposes the derived readiness.

## Approval gates

1. Shot Plan requires `SCRIPT_APPROVED`.
2. Pilot requires approved script and a Shot Plan; duration is 10–20 seconds.
3. Full-film production requires `PILOT_APPROVED` and all seven pilot QC checks.
4. Publishing requires final-film approval and all seven final QC checks.

## Provider routing

- Script development: OpenAI Responses API with strict structured output. The API
  reads `OPENAI_API_KEY` only from the runtime secret and defaults to
  `gpt-5.6-terra`; `SHORT_FILM_SCRIPT_MODEL` may override the model.
- Image-to-video: Runway, after script/Shot Plan approval and an explicit pilot
  submission action.
- Lip sync: Sync, only for approved pilot/full-film units that require dialogue.
- Voice: an APPROVED Voice Master; no raw source voice is promoted automatically.

Generating a script returns a draft with `PENDING` review and never approves it,
creates a Shot Plan, submits media, or unlocks production. Provider API keys are
not accepted in request bodies and are never persisted in project JSON or logs.

### Runtime secret matrix

| Function | Provider | Runtime secret | Form/API behavior when missing |
| --- | --- | --- | --- |
| Script draft | OpenAI Responses | `OPENAI_API_KEY` | Generate returns `SHORT_FILM_SCRIPT_PROVIDER_NOT_CONFIGURED` |
| Image-to-video | Runway | `RUNWAYML_API_SECRET` | Status is `NOT_CONFIGURED`; no media submission is enabled |
| Lip-sync | Sync | `SYNC_API_KEY` | Status is `NOT_CONFIGURED`; no lip-sync submission is enabled |

### Pilot execution preparation

`POST /v1/projects/:projectId/short-film/pilot/prepare` creates a
`SHORT_FILM_PILOT_EXECUTION_V1` plan only. It performs a fresh server-side
provider-account check for the 10–20 second pilot, requires approved budget,
SCRIPT_APPROVED, locked production readiness, current account checks and manual
Sync Billing confirmation when Sync cannot expose a balance API.

The plan locks identity/voice master IDs, speaker/shot scope, a two-attempt retry
ceiling, 30-second heartbeat, 180-second stale threshold and 900-second hard
timeout. Its submission gate is `AWAITING_PROJECT_OWNER_APPROVAL` and
`provider_calls_made` is always `false`; provider execution remains a separate,
explicitly approved operation.

For long-form projects, `pilot_sampling` requires 2–5 representative clips of
10–20 seconds. The default is three 15-second samples covering identity/dialogue,
motion/performance, and multi-character continuity. Every sample has its own QC
and review gate. Full-production fan-out and final assembly remain locked until
all samples pass QC and the owner approves the aggregate `pilot_batch` gate.

Full-film execution then processes one shot at a time, reuses approved pilot
shot artifacts, persists a heartbeat after every provider transition, and
assembles a 1920x1080 deliverable only after all shots complete. Its budget cap
requires a separate owner approval; approving pilot samples never approves the
full-film spend.
| Character voice | Approved Voice Master | none in this form | Requires an approved library asset |

`GET /v1/short-film/providers/status` returns only provider identifiers and
booleans. It never returns secret values. `POST /v1/short-film/scripts/generate`
is the only provider-executing endpoint introduced here and runs only after an
explicit button action; tests do not invoke it.

Runway media submission remains a separate, cost-incurring production action.
When that action is implemented/enabled, it must poll the task and copy successful
output into project-owned storage because provider output URLs are temporary.
