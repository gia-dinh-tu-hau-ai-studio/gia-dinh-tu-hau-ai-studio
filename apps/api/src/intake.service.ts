import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { normalizeProjectIntake, ProjectSubmitRequestSchema } from "@tu-hau/contracts";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
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

@Injectable()
export class IntakeService {
  constructor(
    private readonly characterLibrary: CharacterLibraryConnector,
    private readonly projectRegistry: ProjectRegistryConnector,
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
        message: "project_id là bắt buộc",
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

  async prepareMvProduction(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }

    try {
      return await this.projectRegistry.prepareMvProduction(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({
          code: "PROJECT_NOT_FOUND",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_PRODUCTION_PREPARATION_INVALID_STATE",
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

  async approveMvProductionPlan(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }

    try {
      return await this.projectRegistry.approveMvProductionPlan(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({
          code: "PROJECT_NOT_FOUND",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_PRODUCTION_PLAN_APPROVAL_INVALID_STATE",
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

  async prepareMvAssets(projectIdInput: string, body: unknown) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException({
        code: "INSTRUMENTAL_MASTER_FILE_ID_REQUIRED",
        message: "instrumental_master_file_id là bắt buộc",
      });
    }
    const instrumentalMasterFileId = String(
      (body as Record<string, unknown>).instrumental_master_file_id ?? "",
    ).trim();
    if (!instrumentalMasterFileId) {
      throw new BadRequestException({
        code: "INSTRUMENTAL_MASTER_FILE_ID_REQUIRED",
        message: "instrumental_master_file_id là bắt buộc",
      });
    }

    try {
      return await this.projectRegistry.prepareMvAssets(
        projectId,
        instrumentalMasterFileId,
      );
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({
          code: "PROJECT_NOT_FOUND",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_ASSET_PREPARATION_INVALID_STATE",
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

  async approveMvAssets(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }

    try {
      return await this.projectRegistry.approveMvAssets(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({
          code: "PROJECT_NOT_FOUND",
          message: error.message,
        });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_ASSET_APPROVAL_INVALID_STATE",
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

  async prepareMvShotPlan(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }

    try {
      return await this.projectRegistry.prepareMvShotPlan(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_SHOT_PLAN_PREPARATION_INVALID_STATE",
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

  async approveMvShotPlan(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }

    try {
      return await this.projectRegistry.approveMvShotPlan(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_SHOT_PLAN_APPROVAL_INVALID_STATE",
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

  async prepareMvTimecodeAlignment(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try {
      return await this.projectRegistry.prepareMvTimecodeAlignment(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_TIMECODE_ALIGNMENT_PREPARATION_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async approveMvTimecodeAlignment(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try {
      return await this.projectRegistry.approveMvTimecodeAlignment(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_TIMECODE_ALIGNMENT_APPROVAL_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async prepareMvRenderPlan(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }
    try {
      return await this.projectRegistry.prepareMvRenderPlan(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_RENDER_PLAN_PREPARATION_INVALID_STATE",
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

  async approveMvRenderPlan(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) {
      throw new BadRequestException({
        code: "PROJECT_ID_REQUIRED",
        message: "project_id là bắt buộc",
      });
    }
    try {
      return await this.projectRegistry.approveMvRenderPlan(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) {
        throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      }
      if (error instanceof ProjectRegistryInvalidStateError) {
        throw new ConflictException({
          code: "MV_RENDER_PLAN_APPROVAL_INVALID_STATE",
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

  async prepareMvRenderExecution(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try {
      return await this.projectRegistry.prepareMvRenderExecution(projectId);
    } catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_RENDER_EXECUTION_PREPARATION_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async approveMvRenderExecution(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.approveMvRenderExecution(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_RENDER_EXECUTION_APPROVAL_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async prepareMvProviderSubmission(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.prepareMvProviderSubmission(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_PROVIDER_SUBMISSION_PREPARATION_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async approveMvProviderSubmission(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.approveMvProviderSubmission(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_PROVIDER_SUBMISSION_APPROVAL_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async prepareMvProviderPilot(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.prepareMvProviderPilot(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_PROVIDER_PILOT_PREPARATION_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async prepareMvDuetBaseComposite(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.prepareMvDuetBaseComposite(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_DUET_BASE_COMPOSITE_PREPARATION_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async executeMvDuetBaseComposite(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.executeMvDuetBaseComposite(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_DUET_BASE_COMPOSITE_EXECUTION_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async approveMvDuetBaseComposite(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.approveMvDuetBaseComposite(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_DUET_BASE_COMPOSITE_APPROVAL_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async approveMvDuetBaseCompositeReview(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.approveMvDuetBaseCompositeReview(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_DUET_BASE_COMPOSITE_REVIEW_APPROVAL_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
      throw error;
    }
  }

  async prepareMvDuetBaseCompositeRollout(projectIdInput: string) {
    const projectId = projectIdInput.trim();
    if (!projectId) throw new BadRequestException({ code: "PROJECT_ID_REQUIRED", message: "project_id là bắt buộc" });
    try { return await this.projectRegistry.prepareMvDuetBaseCompositeRollout(projectId); }
    catch (error) {
      if (error instanceof ProjectRegistryProjectNotFoundError) throw new NotFoundException({ code: "PROJECT_NOT_FOUND", message: error.message });
      if (error instanceof ProjectRegistryInvalidStateError) throw new ConflictException({ code: "MV_DUET_BASE_COMPOSITE_ROLLOUT_PREPARATION_INVALID_STATE", message: error.message });
      if (error instanceof ProjectRegistryNotConfiguredError) throw new ServiceUnavailableException({ code: "PROJECT_REGISTRY_NOT_CONFIGURED", message: error.message });
      if (error instanceof ProjectRegistryUnavailableError) throw new BadGatewayException({ code: "PROJECT_REGISTRY_UNAVAILABLE", message: error.message });
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
          "Cấu hình GIA_DINH_TU_HAU_DATABASE_ID và CHARACTER_LIBRARY_SHEET_NAME; runtime phải có Google Application Default Credentials hoặc GOOGLE_SERVICE_ACCOUNT_JSON.",
      });
    }

    throw new BadGatewayException({
      code: "CHARACTER_LIBRARY_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Không đọc được Character Library",
    });
  }
}
