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

  @Post("projects/:projectId/prepare-mv-shot-plan")
  prepareMvShotPlan(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvShotPlan(projectId);
  }

  @Post("projects/:projectId/approve-mv-shot-plan")
  approveMvShotPlan(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvShotPlan(projectId);
  }

  @Post("projects/:projectId/prepare-mv-timecode-alignment")
  prepareMvTimecodeAlignment(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvTimecodeAlignment(projectId);
  }

  @Post("projects/:projectId/approve-mv-timecode-alignment")
  approveMvTimecodeAlignment(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvTimecodeAlignment(projectId);
  }

  @Post("projects/:projectId/prepare-mv-render-plan")
  prepareMvRenderPlan(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvRenderPlan(projectId);
  }

  @Post("projects/:projectId/approve-mv-render-plan")
  approveMvRenderPlan(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvRenderPlan(projectId);
  }

  @Post("projects/:projectId/prepare-mv-render-execution")
  prepareMvRenderExecution(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvRenderExecution(projectId);
  }

  @Post("projects/:projectId/approve-mv-render-execution")
  approveMvRenderExecution(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvRenderExecution(projectId);
  }

  @Post("projects/:projectId/prepare-mv-provider-submission")
  prepareMvProviderSubmission(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvProviderSubmission(projectId);
  }

  @Post("projects/:projectId/approve-mv-provider-submission")
  approveMvProviderSubmission(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvProviderSubmission(projectId);
  }

  @Post("projects/:projectId/prepare-mv-provider-pilot")
  prepareMvProviderPilot(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvProviderPilot(projectId);
  }

  @Post("projects/:projectId/prepare-mv-duet-base-composite")
  prepareMvDuetBaseComposite(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvDuetBaseComposite(projectId);
  }

  @Post("projects/:projectId/execute-mv-duet-base-composite")
  executeMvDuetBaseComposite(@Param("projectId") projectId: string) {
    return this.intakeService.executeMvDuetBaseComposite(projectId);
  }

  @Post("projects/:projectId/approve-mv-duet-base-composite")
  approveMvDuetBaseComposite(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvDuetBaseComposite(projectId);
  }

  @Post("projects/:projectId/approve-mv-duet-base-composite-review")
  approveMvDuetBaseCompositeReview(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvDuetBaseCompositeReview(projectId);
  }

  @Post("projects/:projectId/prepare-mv-duet-base-composite-rollout")
  prepareMvDuetBaseCompositeRollout(@Param("projectId") projectId: string) {
    return this.intakeService.prepareMvDuetBaseCompositeRollout(projectId);
  }

  @Post("projects/:projectId/approve-mv-duet-base-composite-rollout")
  approveMvDuetBaseCompositeRollout(@Param("projectId") projectId: string) {
    return this.intakeService.approveMvDuetBaseCompositeRollout(projectId);
  }

  @Post("projects/:projectId/execute-mv-duet-base-composite-rollout")
  executeMvDuetBaseCompositeRolloutUnit(@Param("projectId") projectId: string) {
    return this.intakeService.executeMvDuetBaseCompositeRolloutUnit(projectId);
  }

  @Post("projects/:projectId/create-rp015-final-proof")
  createRp015FinalProof(@Param("projectId") projectId: string, @Body() body: unknown) {
    return this.intakeService.createRp015FinalProof(projectId, body);
  }

  @Post("projects/:projectId/prepare-rp015-vocal-pilot")
  prepareRp015VocalPilot(@Param("projectId") projectId: string) {
    return this.intakeService.prepareRp015VocalPilot(projectId);
  }

  @Post("projects/:projectId/prepare-rp015-clean-voice-references")
  prepareRp015CleanVoiceReferences(@Param("projectId") projectId: string) {
    return this.intakeService.prepareRp015CleanVoiceReferences(projectId);
  }

  @Post("projects/:projectId/approve-rp015-clean-voice-references")
  approveRp015CleanVoiceReferences(@Param("projectId") projectId: string) {
    return this.intakeService.approveRp015CleanVoiceReferences(projectId);
  }
}
