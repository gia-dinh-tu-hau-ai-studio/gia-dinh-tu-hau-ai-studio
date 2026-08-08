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

No endpoint in this version invokes Runway, Luma, Sync, or another provider.
