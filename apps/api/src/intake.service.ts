import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { normalizeProjectIntake } from "@tu-hau/contracts";
import { ZodError } from "zod";
import {
  CharacterLibraryConnector,
  CharacterLibraryNotConfiguredError,
} from "./connectors/google-sheets/character-library.connector";

@Injectable()
export class IntakeService {
  constructor(private readonly characterLibrary: CharacterLibraryConnector) {}

  async listEligibleCharacters() {
    try {
      return await this.characterLibrary.listEligibleCharacters();
    } catch (error) {
      this.handleLibraryError(error);
    }
  }

  async validate(body: unknown) {
    try {
      const contract = normalizeProjectIntake(body);
      const eligibleCharacters = await this.characterLibrary.listEligibleCharacters();
      const libraryById = new Map(
        eligibleCharacters.map((character) => [character.character_id, character]),
      );

      for (const assignment of contract.characters) {
        const libraryCharacter = libraryById.get(assignment.character_id);

        if (!libraryCharacter) {
          throw new BadRequestException({
            validation_status: "FAIL",
            code: "CHARACTER_NOT_ELIGIBLE",
            character_id: assignment.character_id,
          });
        }

        if (
          assignment.selected_costume_ids.length > 0 &&
          (!libraryCharacter.default_costume_id ||
          assignment.selected_costume_ids.some(
            (costumeId) => costumeId !== libraryCharacter.default_costume_id,
          ))
        ) {
          throw new BadRequestException({
            validation_status: "FAIL",
            code: "COSTUME_NOT_APPROVED",
            character_id: assignment.character_id,
          });
        }

        if (assignment.voice_required && !libraryCharacter.voice_available) {
          throw new BadRequestException({
            validation_status: "FAIL",
            code: "VOICE_NOT_APPROVED",
            character_id: assignment.character_id,
          });
        }
      }

      return {
        validation_status: "PASSED",
        next_system: "AI_MUSIC_FACTORY",
        project_id_created: false,
        contract,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          validation_status: "FAIL",
          errors: error.issues,
        });
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.handleLibraryError(error);
      throw error;
    }
  }

  private handleLibraryError(error: unknown): never {
    if (error instanceof CharacterLibraryNotConfiguredError) {
      throw new ServiceUnavailableException({
        code: "CHARACTER_LIBRARY_NOT_CONFIGURED",
        message:
          "Cấu hình GOOGLE_SHEETS_DATABASE_ID và CHARACTER_LIBRARY_SHEET_NAME; runtime phải có Google Application Default Credentials hoặc GOOGLE_SERVICE_ACCOUNT_JSON.",
      });
    }

    throw new BadGatewayException({
      code: "CHARACTER_LIBRARY_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Không đọc được Character Library",
    });
  }
}
