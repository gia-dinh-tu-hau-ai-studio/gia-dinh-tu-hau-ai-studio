import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  AiMusicFactorySubmitRequestSchema,
  normalizeProjectIntake,
} from "@tu-hau/contracts";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  CharacterLibraryConnector,
  CharacterLibraryNotConfiguredError,
} from "./connectors/google-sheets/character-library.connector";
import {
  AiMusicFactoryConnector,
  AiMusicFactoryInvalidResponseError,
  AiMusicFactoryNotConfiguredError,
  AiMusicFactoryUnavailableError,
} from "./connectors/n8n/ai-music-factory.connector";

@Injectable()
export class IntakeService {
  constructor(
    private readonly characterLibrary: CharacterLibraryConnector,
    private readonly aiMusicFactory: AiMusicFactoryConnector,
  ) {}

  async listEligibleCharacters() {
    try {
      return await this.characterLibrary.listEligibleCharacters();
    } catch (error) {
      this.handleLibraryError(error);
    }
  }

  async validate(body: unknown) {
    try {
      const contract = await this.validateContract(body);

      return {
        validation_status: "PASSED",
        next_system: "AI_MUSIC_FACTORY",
        project_id_created: false,
        submission_id: randomUUID(),
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

  async submit(body: unknown) {
    try {
      const request = AiMusicFactorySubmitRequestSchema.parse(body);
      const contract = await this.validateContract(request.payload);
      const project = await this.aiMusicFactory.createProject(
        contract,
        request.submission_id,
      );

      return {
        submission_status: "ACCEPTED",
        next_system: "AI_MUSIC_FACTORY",
        project_id_created: true,
        submission_id: request.submission_id,
        project,
      };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          submission_status: "FAIL",
          errors: error.issues,
        });
      }
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof AiMusicFactoryNotConfiguredError) {
        throw new ServiceUnavailableException({
          code: "AI_MUSIC_FACTORY_NOT_CONFIGURED",
          message: "Chưa cấu hình webhook AI_MUSIC_FACTORY.",
        });
      }
      if (error instanceof AiMusicFactoryInvalidResponseError) {
        throw new BadGatewayException({
          code: "AI_MUSIC_FACTORY_INVALID_RESPONSE",
          message: "AI_MUSIC_FACTORY chưa trả project_id hợp lệ.",
        });
      }
      if (error instanceof AiMusicFactoryUnavailableError) {
        throw new BadGatewayException({
          code: "AI_MUSIC_FACTORY_UNAVAILABLE",
          message: error.message,
        });
      }
      this.handleLibraryError(error);
      throw error;
    }
  }

  private async validateContract(body: unknown) {
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

    return contract;
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
