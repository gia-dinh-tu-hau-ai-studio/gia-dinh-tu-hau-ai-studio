
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  normalizeProjectIntake,
  prepareShortFilmPilotPlan,
  ProviderBudgetPlanSchema,
  ProjectSubmitRequestSchema,
  ShortFilmScriptGenerationRequestSchema,
  ShortFilmWorkflowUpdateRequestSchema,
} from "@tu-hau/contracts";
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import {
  CharacterLibraryConnector,
  CharacterLibraryNotConfiguredError,
} from "./connectors/google-sheets/character-library.connector";
import {
  ProjectRegistryConnector,
  ProjectRegistryInvalidStateError,
  ProjectRegistryNotConfiguredError,
  ProjectRegistryProjectNotFoundError,
  ProjectRegistryUnavailableError,
} from "./connectors/google-sheets/project-registry.connector";
import {
  ShortFilmScriptProvider,
  ShortFilmScriptProviderNotConfiguredError,
  ShortFilmScriptProviderUnavailableError,
} from "./providers/short-film-script.provider";
import { getShortFilmProviderStatus } from "./providers/short-film-provider-status";
import { checkProviderAccounts } from "./providers/provider-account-preflight";
import { DriveConnector } from "./connectors/google-drive/drive.connector";

@Injectable()
export class IntakeService {
  constructor(
    private readonly characterLibrary: CharacterLibraryConnector,
    private readonly projectRegistry: ProjectRegistryConnector,
    private readonly shortFilmScriptProvider: ShortFilmScriptProvider,
    private readonly drive: DriveConnector,
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
        next_system: "GIA_DINH_TU_HAU_STUDIO",
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
      const request = ProjectSubmitRequestSchema.parse(body);
      const contract = await this.validateContract(request.payload);
      const project = await this.projectRegistry.createProject(
        contract,
        request.submission_id,
      );

      return {
        submission_status: "ACCEPTED",
        next_system: "GIA_DINH_TU_HAU_STUDIO",
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
      if (error instanceof ProjectRegistryNotConfiguredError) {
        throw new ServiceUnavailableException({
          code: "PROJECT_REGISTRY_NOT_CONFIGURED",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryUnavailableError) {
        throw new BadGatewayException({
          code: "PROJECT_REGISTRY_UNAVAILABLE",
          message: error.message,
        });
      }
      this.handleLibraryError(error);
      throw error;
    }
  }

  async approveContract(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id lÃ  báº¯t buá»™c",
      });
    }

    try {
      return await this.projectRegistry.approveContract(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({
          code: "PROJECT_NOT_FOUND",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "CONTRACT_APPROVAL_INVALID_STATE",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryNotConfiguredError) {
        throw new ServiceUnavailableException({
          code: "PROJECT_REGISTRY_NOT_CONFIGURED",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryUnavailableError) {
        throw new BadGatewayException({
          code: "PROJECT_REGISTRY_UNAVAILABLE",
          message: error.message,
        });
      }
      throw error;
    }
  }

  async getShortFilmWorkflow(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id lÃ  báº¯t buá»™c" });
    try {
      return await this.projectRegistry.getShortFilmWorkflow(projectId);
    } catch (error) {
      this.handleShortFilmWorkflowError(error);
    }
  }

  async getProjectProgress(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id lÃ  báº¯t buá»™c" });
    try {
      return await this.projectRegistry.getProjectProgress(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      }
      if (error instanceof ProjectRegistryNotConfiguredError) {
        throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      }
      throw new BadGatewayException({ code: "PROJECT_PROGRESS_UNAVAILABLE", message: error instanceof Error ? error.message : "KhÃ´ng Ä‘á»c Ä‘Æ°á»£c tiáº¿n Ä‘á»™ dá»± Ã¡n" });
    }
  }

  async saveShortFilmWorkflow(projectIdInput: string, body: unknown) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id lÃ  báº¯t buá»™c" });
    try {
      const request = ShortFilmWorkflowUpdateRequestSchema.parse(body);
      return await this.projectRegistry.saveShortFilmWorkflow(projectId, request.workflow);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({ code: "SHORT_FILM_WORKFLOW_INVALID", errors: error.issues });
      }
      this.handleShortFilmWorkflowError(error);
    }
  }

  async generateShortFilmScript(body: unknown) {
    try {
      const request = ShortFilmScriptGenerationRequestSchema.parse(body);
      return await this.shortFilmScriptProvider.generate(request);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({ code: "SHORT_FILM_SCRIPT_REQUEST_INVALID", errors: error.issues });
      }
      if (error instanceof ShortFilmScriptProviderNotConfiguredError) {
        throw new ServiceUnavailableException({ code: "SHORT_FILM_SCRIPT_PROVIDER_NOT_CONFIGURED", message: error.message });
      }
      if (error instanceof ShortFilmScriptProviderUnavailableError) {
        throw new BadGatewayException({ code: "SHORT_FILM_SCRIPT_PROVIDER_UNAVAILABLE", message: error.message });
      }
      throw error;
    }
  }

  shortFilmProviderStatus() {
    return getShortFilmProviderStatus(process.env);
  }

  async checkProviderAccounts(body: unknown) {
    try {
      return await checkProviderAccounts(body, process.env);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new BadRequestException({
          code: "PROVIDER_ACCOUNT_PREFLIGHT_REQUEST_INVALID",
          message: "Dá»¯ liá»‡u dá»± toÃ¡n gá»­i sang kiá»ƒm tra tÃ i khoáº£n khÃ´ng há»£p lá»‡.",
          errors: error.issues,
        });
      }
      throw error;
    }
  }

  async prepareShortFilmPilot(projectIdInput: string, body: unknown) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id lÃ  báº¯t buá»™c" });
    const requestSchema = z.object({
      provider_budget: ProviderBudgetPlanSchema,
      pilot_duration_seconds: z.number().int().min(10).max(30).optional(),
      manual_sync_balance_confirmed: z.boolean().default(false),
    });
    try {
      const request = requestSchema.parse(body);
      const stored = await this.projectRegistry.getShortFilmWorkflow(projectId);
      const pilotDurationSeconds = stored.workflow.pilot_sampling.clip_duration_seconds;
      const pilotSampleCount = stored.workflow.pilot_sampling.sample_count;
      const checked = await checkProviderAccounts({
        project_type: "SHORT_FILM",
        duration_seconds: pilotDurationSeconds * pilotSampleCount,
        providers: request.provider_budget.providers,
      }, process.env);
      const preparedAt = new Date().toISOString();
      const relevant = new Set(["RUNWAY", "ELEVENLABS", "SYNC"]);
      const accountChecks = checked.providers
        .filter((item) => relevant.has(item.provider))
        .map((item) => ({
          provider: item.provider as "RUNWAY" | "ELEVENLABS" | "SYNC",
          status: item.status,
          checked_at: preparedAt,
          manual_balance_confirmed: item.provider === "SYNC" && request.manual_sync_balance_confirmed,
        }));
      const plan = prepareShortFilmPilotPlan({
        project_id: projectId,
        workflow: stored.workflow,
        provider_budget: request.provider_budget,
        pilot_duration_seconds: pilotDurationSeconds,
        account_checks: accountChecks,
        prepared_at: preparedAt,
      });
      const context = await this.projectRegistry.getShortFilmExecutionContext(projectId);
      const manifestFileId = await this.drive.writePilotJson(context.project_folder_id, "SHORT_FILM_PILOT_EXECUTION_V1.json", plan);
      return { ...plan, manifest_file_id: manifestFileId };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new ConflictException({ code: "SHORT_FILM_PILOT_PREPARATION_BLOCKED", errors: error.issues });
      }
      this.handleShortFilmWorkflowError(error);
    }
  }

  private handleShortFilmWorkflowError(error: unknown): never {
    if (error instanceof ProjectRegistryProjectNotFoundError) {
      throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
    }
    if (error instanceof ProjectRegistryInvalidStateError) {
      throw new ConflictException({ code: "SHORT_FILM_WORKFLOW_INVALID_STATE", message: error.message });
    }
    if (error instanceof ProjectRegistryNotConfiguredError) {
      throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
    }
    if (error instanceof ProjectRegistryUnavailableError) {
      throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
    }
    throw error;
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
          "Cáº¥u hÃ¬nh GIA_DINH_TU_HAU_DATABASE_ID vÃ  CHARACTER_LIBRARY_SHEET_NAME; runtime pháº£i cÃ³ Google Application Default Credentials hoáº·c GOOGLE_SERVICE_ACCOUNT_JSON.",
      });
    }

    throw new BadGatewayException({
      code: "CHARACTER_LIBRARY_UNAVAILABLE",
      message: error instanceof Error ? error.message : "KhÃ´ng Ä‘á»c Ä‘Æ°á»£c Character Library",
    });
  }
}
