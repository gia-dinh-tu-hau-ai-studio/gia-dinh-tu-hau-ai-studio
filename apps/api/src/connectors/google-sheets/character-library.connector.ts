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

export type EligibleCharacter = {
  character_id: string;
  character_name: string;
  character_type: string;
  default_costume_id: string;
  voice_available: boolean;
  readiness: {
    character: "ACTIVE";
    image: "IMAGE_READY";
    legal: "LEGAL_CLEARED";
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
    const databaseId = process.env.GOOGLE_SHEETS_DATABASE_ID;

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
    const spreadsheetId = process.env.GOOGLE_SHEETS_DATABASE_ID as string;
    const sheetName = process.env.CHARACTER_LIBRARY_SHEET_NAME ?? "11_CHARACTER_LIBRARY";
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
      throw new Error(`11_CHARACTER_LIBRARY thiếu cột: ${missingColumns.join(", ")}`);
    }

    return values
      .slice(1)
      .map((row) => this.mapRow(row, indexByColumn))
      .filter((row) => this.isEligible(row))
      .map((row) => ({
        character_id: row.character_id,
        character_name: row.character_name,
        character_type: row.character_type,
        default_costume_id: row.default_costume_id,
        voice_available: Boolean(row.voice_reference_url),
        readiness: {
          character: "ACTIVE",
          image: "IMAGE_READY",
          legal: "LEGAL_CLEARED",
        },
      }));
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
}
