import { Body, Controller, Get, Post } from "@nestjs/common";
import { IntakeService } from "./intake.service";

@Controller()
export class AppController {
  constructor(private readonly intakeService: IntakeService) {}

  @Get("health")
  health() {
    return {
      service: "gia-dinh-tu-hau-ai-executor-api",
      status: "ok",
      architecture: "331-compatible",
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
}
