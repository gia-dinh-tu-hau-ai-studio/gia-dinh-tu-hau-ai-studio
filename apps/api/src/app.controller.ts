import { Body, Controller, Get, Param, Post, Put, StreamableFile } from "@nestjs/common";
import { IntakeService } from "./intake.service";
import { ShortFilmPilotExecutionService } from "./providers/short-film-pilot-execution.service";
import { ShortFilmFullExecutionService } from "./providers/short-film-full-execution.service";
import { z } from "zod";

@Controller()
export class AppController {
  constructor(
    private readonly intakeService: IntakeService,
    private readonly pilotExecution: ShortFilmPilotExecutionService,
    private readonly fullExecution: ShortFilmFullExecutionService,
  ) {}

  @Get("health")
  health() {
    return {
      service: "gia-dinh-tu-hau-ai-executor-api",
      status: "ok",
      architecture: "gia-dinh-tu-hau-v1",
      production_priority: "SHORT_FILM_FIRST",
      short_film_form: "SHORT_FILM_FORM_V1",
      identity_pipeline: "MASTER_IDENTITY_APPROVED_LOCKED",
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

  @Get("projects/:projectId/short-film/workflow")
  getShortFilmWorkflow(@Param("projectId") projectId: string) {
    return this.intakeService.getShortFilmWorkflow(projectId);
  }

  @Get("projects/:projectId/progress")
  getProjectProgress(@Param("projectId") projectId: string) {
    return this.intakeService.getProjectProgress(projectId);
  }

  @Put("projects/:projectId/short-film/workflow")
  saveShortFilmWorkflow(@Param("projectId") projectId: string, @Body() body: unknown) {
    return this.intakeService.saveShortFilmWorkflow(projectId, body);
  }

  @Post("short-film/scripts/generate")
  generateShortFilmScript(@Body() body: unknown) {
    return this.intakeService.generateShortFilmScript(body);
  }

  @Get("short-film/providers/status")
  shortFilmProviderStatus() {
    return this.intakeService.shortFilmProviderStatus();
  }

  @Post("short-film/providers/account-check")
  checkProviderAccounts(@Body() body: unknown) {
    return this.intakeService.checkProviderAccounts(body);
  }

  @Post("projects/:projectId/short-film/pilot/prepare")
  prepareShortFilmPilot(@Param("projectId") projectId: string, @Body() body: unknown) {
    return this.intakeService.prepareShortFilmPilot(projectId, body);
  }

  @Post("projects/:projectId/short-film/pilot/execute")
  executeShortFilmPilot(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({
      execution_approved: z.literal(true),
      caps: z.object({ runway_credits: z.number().int().positive(), elevenlabs_characters: z.number().int().nonnegative(), sync_usd: z.number().nonnegative() }),
    }).parse(body);
    return this.pilotExecution.submit(projectId, request.caps);
  }

  @Get("projects/:projectId/short-film/pilot/status")
  shortFilmPilotStatus(@Param("projectId") projectId: string) {
    return this.pilotExecution.status(projectId);
  }

  @Get("projects/:projectId/short-film/pilot/outputs/:fileId")
  async shortFilmPilotOutput(@Param("projectId") projectId: string, @Param("fileId") fileId: string) {
    return new StreamableFile(await this.pilotExecution.output(projectId, fileId), { type: "video/mp4", disposition: "inline" });
  }

  @Post("projects/:projectId/short-film/full-film/execute")
  executeShortFilmFullFilm(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({
      execution_approved: z.literal(true),
      caps: z.object({ runway_credits: z.number().int().positive(), elevenlabs_characters: z.number().int().nonnegative(), sync_usd: z.number().nonnegative() }),
    }).parse(body);
    return this.fullExecution.start(projectId, request.caps);
  }

  @Post("projects/:projectId/short-film/full-film/status")
  shortFilmFullFilmStatus(@Param("projectId") projectId: string) {
    return this.fullExecution.tick(projectId);
  }

  @Get("projects/:projectId/short-film/full-film/outputs/:fileId")
  async shortFilmFullFilmOutput(@Param("projectId") projectId: string, @Param("fileId") fileId: string) {
    return new StreamableFile(await this.fullExecution.output(projectId, fileId), { type: "video/mp4", disposition: "inline" });
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
    return this.intakeService.startRp015FinalProof(projectId, body);
  }

  @Get("projects/:projectId/rp015-final-proof-status")
  getRp015FinalProofStatus(@Param("projectId") projectId: string) {
    return this.intakeService.getRp015FinalProofStatus(projectId);
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

  @Post("projects/:projectId/approve-rp015-vocal-pilot")
  approveRp015VocalPilot(@Param("projectId") projectId: string) {
    return this.intakeService.approveRp015VocalPilot(projectId);
  }
}
