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

  @Post("projects/:projectId/short-film/pilot/reject-and-restart")
  rejectAndRestartShortFilmPilot(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({
      rejection_confirmed: z.literal(true),
      caps: z.object({ runway_credits: z.number().int().positive(), elevenlabs_characters: z.number().int().nonnegative(), sync_usd: z.number().nonnegative() }),
    }).parse(body);
    return this.pilotExecution.rejectAndRestartForDialogueAudio(projectId, request.caps);
  }

  @Post("projects/:projectId/short-film/pilot/dialogue-audio/review")
  reviewShortFilmPilotDialogueAudio(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).parse(body);
    return this.pilotExecution.reviewDialogueAudio(projectId, request.decision);
  }

  @Get("projects/:projectId/short-film/pilot/dialogue-audio/:fileId")
  async shortFilmPilotDialogueAudio(@Param("projectId") projectId: string, @Param("fileId") fileId: string) {
    return new StreamableFile(await this.pilotExecution.audio(projectId, fileId), { type: "audio/mpeg", disposition: "inline" });
  }

  @Get("projects/:projectId/short-film/pilot/outputs/:fileId")
  async shortFilmPilotOutput(@Param("projectId") projectId: string, @Param("fileId") fileId: string) {
    return new StreamableFile(await this.pilotExecution.output(projectId, fileId), { type: "video/mp4", disposition: "inline" });
  }

  @Post("projects/:projectId/short-film/pilot/performance-variant/execute")
  executeShortFilmPilotPerformanceVariant(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({
      execution_approved: z.literal(true),
      shot_id: z.string().min(1),
      duration_seconds: z.literal(10),
      caps: z.object({ runway_credits: z.literal(50), sync_usd: z.literal(0.5) }),
    }).parse(body);
    return this.pilotExecution.startPerformanceVariant(projectId, request);
  }

  @Get("projects/:projectId/short-film/pilot/performance-variant/status")
  shortFilmPilotPerformanceVariantStatus(@Param("projectId") projectId: string) {
    return this.pilotExecution.performanceVariantStatus(projectId);
  }

  @Post("projects/:projectId/short-film/pilot/performance-variant/review")
  reviewShortFilmPilotPerformanceVariant(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({ decision: z.enum(["APPROVE", "REJECT"]) }).parse(body);
    return this.pilotExecution.reviewPerformanceVariant(projectId, request.decision);
  }

  @Get("projects/:projectId/short-film/pilot/performance-variant/outputs/:fileId")
  async shortFilmPilotPerformanceVariantOutput(@Param("projectId") projectId: string, @Param("fileId") fileId: string) {
    return new StreamableFile(await this.pilotExecution.performanceVariantOutput(projectId, fileId), { type: "video/mp4", disposition: "inline" });
  }

  @Post("projects/:projectId/short-film/pilot/evaluation-reel/execute")
  executeShortFilmPilotEvaluationReel(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({ execution_approved: z.literal(true), duration_seconds: z.literal(30), caps: z.object({ runway_credits: z.literal(432), elevenlabs_characters: z.literal(2000), sync_usd: z.literal(1.8) }) }).parse(body);
    return this.pilotExecution.startEvaluationReel(projectId, request);
  }

  @Get("projects/:projectId/short-film/pilot/evaluation-reel/status")
  shortFilmPilotEvaluationReelStatus(@Param("projectId") projectId: string) { return this.pilotExecution.evaluationReelStatus(projectId); }

  @Post("projects/:projectId/short-film/pilot/evaluation-reel/review")
  reviewShortFilmPilotEvaluationReel(@Param("projectId") projectId: string, @Body() body: unknown) {
    const qc = z.object({ identity_locked: z.boolean(), cinematic_setting: z.boolean(), purposeful_action: z.boolean(), emotional_arc: z.boolean(), dialogue_lip_sync: z.boolean(), voice_match: z.boolean(), continuity: z.boolean(), exact_duration_30s: z.boolean() });
    const request = z.object({ decision: z.enum(["APPROVE", "REJECT"]), qc }).parse(body);
    return this.pilotExecution.reviewEvaluationReel(projectId, request);
  }

  @Post("projects/:projectId/short-film/pilot/evaluation-reel/resume")
  resumeShortFilmPilotEvaluationReel(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({ execution_approved: z.literal(true), duration_seconds: z.literal(30), caps: z.object({ runway_credits: z.literal(432), elevenlabs_characters: z.literal(2000), sync_usd: z.literal(1.8) }) }).parse(body);
    return this.pilotExecution.resumeEvaluationReel(projectId, request);
  }

  @Post("projects/:projectId/short-film/pilot/evaluation-reel/restart")
  restartShortFilmPilotEvaluationReel(@Param("projectId") projectId: string, @Body() body: unknown) {
    const request = z.object({ execution_approved: z.literal(true), duration_seconds: z.literal(30), caps: z.object({ runway_credits: z.literal(432), elevenlabs_characters: z.literal(2000), sync_usd: z.literal(1.8) }) }).parse(body);
    return this.pilotExecution.restartEvaluationReel(projectId, request);
  }

  @Get("projects/:projectId/short-film/pilot/evaluation-reel/outputs/:fileId")
  async shortFilmPilotEvaluationReelOutput(@Param("projectId") projectId: string, @Param("fileId") fileId: string) {
    return new StreamableFile(await this.pilotExecution.evaluationReelOutput(projectId, fileId), { type: "video/mp4", disposition: "inline" });
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
}
