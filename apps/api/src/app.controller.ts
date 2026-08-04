import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { IntakeService } from "./intake.service";

@Controller()
export class AppController {
  constructor(private readonly intakeService: IntakeService) {}

  @Get("health")
  health() {
    return {
      service: "gia-dinh-tu-hau-ai-executor-api",
      status: "ok",
      architecture: "gia-dinh-tu-hau-v1",
      production_priority: "MUSIC_VIDEO_FIRST",
      face_identity_pipeline: "ORIGINAL_FACE_COMPOSITE",
    };
  }

  @Get("characters/eligible")
  listEligibleCharacters() {
    return this.intakeService.listEligibleCharacters();
  }

  @Post("intake/validate")
  validateIntake(@Body() body: unknown) {
    return this.intakeService.validate(body);
  }

  @Post("intake/submit")
  submitIntake(@Body() body: unknown) {
    return this.intakeService.submit(body);
  }

  @Post("projects/:projectId/approve-contract")
  approveContract(@Param("projectId") projectId: string) {
    return this.intakeService.approveContract(projectId);
  }

  @Post("projects/:projectId/prepare-mv-production")
  prepareMvProduction(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvProduction(projectId);
  }

  @Post("projects/:projectId/approve-mv-production-plan")
  approveMvProductionPlan(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvProductionPlan(projectId);
  }

  @Post("projects/:projectId/prepare-mv-assets")
  prepareMvAssets(@Param("projectId") projectId: string, @Body() body: unknown) {
    return this.intakeService.prepareMvAssets(projectId, body);
  }

  @Post("projects/:projectId/approve-mv-assets")
  approveMvAssets(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvAssets(projectId);
  }
}
