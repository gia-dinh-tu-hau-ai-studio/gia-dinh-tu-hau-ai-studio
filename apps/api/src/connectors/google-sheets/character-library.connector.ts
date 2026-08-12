import { Injectable } from "@nestjs/common";
import { google, sheets_v4 } from "googleapis";

const CHARACTER_LIBRARY_COLUMNS = [
  "character_id",
  "character_name",
  "character_type",
  "project_id_origin",
  "gender",
  "age_range",
  "ethnicity_or_style",
  "visual_identity_json",
  "face_reference_url",
  "body_reference_url",
  "voice_identity_json",
  "voice_reference_url",
  "default_costume_id",
  "consent_status",
  "usage_scope",
  "rights_status",
  "version",
  "status",
  "created_at",
  "updated_at",
  "notes",
] as const;

type CharacterLibraryColumn = (typeof CHARACTER_LIBRARY_COLUMNS)[number];
type CharacterLibraryRow = Record<CharacterLibraryColumn, string>;

export function isMasterIdentityApprovedLocked(visualIdentityJson: string) {
  try {
    const identity = JSON.parse(visualIdentityJson || "{}") as Record<string, unknown>;
    const status = String(identity.master_identity_status ?? identity.approval_status ?? "").toUpperCase();
    const lock = String(identity.lock_status ?? identity.master_identity_lock ?? "").toUpperCase();
    return status === "APPROVED" && lock === "LOCKED";
  } catch {
    return false;
  }
}

export type EligibleCharacter = {
  character_id: string;
  character_name: string;
  character_type: string;
  default_costume_id: string;
  voice_available: boolean;
  face_reference_url: string;
  body_reference_url: string;
  master_identity_id?: string;
  master_identity_version?: string;
  voice_master_id?: string;
  elevenlabs_voice_id?: string;
  voice_casting_profile?: string;
  voice_perceived_age_band?: "YOUNG_ADULT" | "ADULT" | "MIDDLE_AGED" | "OLDER_ADULT";
  voice_locale?: "vi-VN-southwest";
  voice_performance_style?: "SOUTHERN_TV_DRAMA_DUBBING";
  pronunciation_lexicon_id?: string;
  voice_audition_audio_url?: string;
  voice_audition_approved?: boolean;
  readiness: {
    character: "ACTIVE";
    image: "IMAGE_READY";
    legal: "LEGAL_CLEARED";
    master_identity: "APPROVED_LOCKED" | "NOT_READY";
    voice_master: "APPROVED_LOCKED" | "NOT_READY";
  };
};

export class CharacterLibraryNotConfiguredError extends Error {
  constructor() {
    super("Character Library chưa được cấu hình");
    this.name = "CharacterLibraryNotConfiguredError";
  }
}

@Injectable()
export class CharacterLibraryConnector {
  private createClient(): sheets_v4.Sheets {
    const rawCredentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const databaseId = process.env.GIA_DINH_TU_HAU_DATABASE_ID;

    if (!databaseId) {
      throw new CharacterLibraryNotConfiguredError();
    }

    const auth = rawCredentials
      ? new google.auth.GoogleAuth({
          credentials: JSON.parse(rawCredentials) as Record<string, unknown>,
          scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        })
      : new google.auth.GoogleAuth({
          scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
        });

    return google.sheets({ version: "v4", auth });
  }

  async listEligibleCharacters(): Promise<EligibleCharacter[]> {
    const sheets = this.createClient();
    const spreadsheetId = process.env.GIA_DINH_TU_HAU_DATABASE_ID as string;
    const sheetName = process.env.CHARACTER_LIBRARY_SHEET_NAME ?? "CHARACTER_LIBRARY";
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetName}'!A:U`,
    });
    const values = response.data.values ?? [];

    if (values.length === 0) {
      return [];
    }

    const header = values[0]?.map((value) => String(value).trim()) ?? [];
    const indexByColumn = new Map(header.map((column, index) => [column, index]));
    const missingColumns = CHARACTER_LIBRARY_COLUMNS.filter(
      (column) => !indexByColumn.has(column),
    );

    if (missingColumns.length > 0) {
      throw new Error(`CHARACTER_LIBRARY thiếu cột: ${missingColumns.join(", ")}`);
    }

    return values
      .slice(1)
      .map((row) => this.mapRow(row, indexByColumn))
      .filter((row) => this.isEligible(row) && this.masterIdentityApprovedLocked(row) && this.voiceMasterApprovedLocked(row))
      .map((row) => {
        const identity = this.parseJson(row.visual_identity_json);
        const voice = this.parseJson(row.voice_identity_json);
        const identityLocked = this.masterIdentityApprovedLocked(row);
        const voiceLocked = this.voiceMasterApprovedLocked(row);
        return {
          character_id: row.character_id,
          character_name: row.character_name,
          character_type: row.character_type,
          default_costume_id: row.default_costume_id,
          voice_available: voiceLocked,
          face_reference_url: row.face_reference_url,
          body_reference_url: row.body_reference_url,
          master_identity_id: identityLocked ? String(identity.master_identity_id ?? "").trim() || `CHARACTER_MASTER:${row.character_id}` : undefined,
          master_identity_version: identityLocked ? String(identity.reference_set_version ?? row.version).trim() || undefined : undefined,
          voice_master_id: voiceLocked ? String(voice.voice_master_id ?? "").trim() || undefined : undefined,
          elevenlabs_voice_id: voiceLocked ? String(voice.elevenlabs_voice_id ?? voice.provider_voice_id ?? "").trim() || undefined : undefined,
          voice_casting_profile: voiceLocked ? String(voice.casting_profile ?? "").trim() || undefined : undefined,
          voice_perceived_age_band: voiceLocked ? this.voiceAgeBand(voice, row) : undefined,
          voice_locale: voiceLocked && String(voice.locale ?? "vi-VN-southwest") === "vi-VN-southwest" ? "vi-VN-southwest" : undefined,
          voice_performance_style: voiceLocked && String(voice.performance_style ?? "SOUTHERN_TV_DRAMA_DUBBING") === "SOUTHERN_TV_DRAMA_DUBBING" ? "SOUTHERN_TV_DRAMA_DUBBING" : undefined,
          pronunciation_lexicon_id: voiceLocked ? String(voice.pronunciation_lexicon_id ?? "GDTH-VI-SOUTHWEST-V1").trim() || undefined : undefined,
          voice_audition_audio_url: voiceLocked ? String(voice.audition_audio_url ?? row.voice_reference_url).trim() || undefined : undefined,
          voice_audition_approved: voiceLocked && String((voice.audition_review as Record<string, unknown> | undefined)?.decision ?? voice.audition_status ?? "APPROVE").toUpperCase() === "APPROVE",
          readiness: {
            character: "ACTIVE" as const,
            image: "IMAGE_READY" as const,
            legal: "LEGAL_CLEARED" as const,
            master_identity: identityLocked ? "APPROVED_LOCKED" as const : "NOT_READY" as const,
            voice_master: voiceLocked ? "APPROVED_LOCKED" as const : "NOT_READY" as const,
          },
        };
      });
  }

  private mapRow(
    row: unknown[],
    indexByColumn: Map<string, number>,
  ): CharacterLibraryRow {
    return Object.fromEntries(
      CHARACTER_LIBRARY_COLUMNS.map((column) => [
        column,
        String(row[indexByColumn.get(column) as number] ?? "").trim(),
      ]),
    ) as CharacterLibraryRow;
  }

  private isEligible(row: CharacterLibraryRow): boolean {
    const active = row.status === "ACTIVE";
    const imageReady = Boolean(row.face_reference_url && row.body_reference_url);
    const legalCleared =
      ["APPROVED", "CONFIRMED"].includes(row.consent_status) &&
      ["APPROVED", "CLEARED", "LEGAL_CLEARED"].includes(row.rights_status);

    return active && imageReady && legalCleared;
  }

  private masterIdentityApprovedLocked(row: CharacterLibraryRow) {
    return isMasterIdentityApprovedLocked(row.visual_identity_json);
  }

  private voiceMasterApprovedLocked(row: CharacterLibraryRow) {
    const voice = this.parseJson(row.voice_identity_json);
    const status = String(voice.voice_master_status ?? voice.approval_status ?? "").toUpperCase();
    const lock = String(voice.lock_status ?? voice.voice_master_lock ?? "").toUpperCase();
    return status === "APPROVED" && lock === "LOCKED" && Boolean(String(voice.voice_master_id ?? "").trim());
  }

  private voiceAgeBand(voice: Record<string, unknown>, row: CharacterLibraryRow): EligibleCharacter["voice_perceived_age_band"] {
    const explicit = String(voice.perceived_age_band ?? "").toUpperCase();
    if (["YOUNG_ADULT", "ADULT", "MIDDLE_AGED", "OLDER_ADULT"].includes(explicit)) {
      return explicit as EligibleCharacter["voice_perceived_age_band"];
    }
    const profile = `${row.character_name} ${row.age_range} ${String(voice.casting_profile ?? "")}`.toLowerCase();
    if (/bà|cao tuổi|older|elder|60|70/.test(profile)) return "OLDER_ADULT";
    if (/trung niên|middle|40|50/.test(profile)) return "MIDDLE_AGED";
    if (/trẻ|young|18|20/.test(profile)) return "YOUNG_ADULT";
    return "ADULT";
  }

  private parseJson(value: string): Record<string, unknown> {
    try {
      return JSON.parse(value || "{}") as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}
