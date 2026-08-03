import { BadRequestException, Injectable } from "@nestjs/common";
import { normalizeProjectIntake } from "@tu-hau/contracts";
import { ZodError } from "zod";

@Injectable()
export class IntakeService {
  validate(body: unknown) {
    try {
      const contract = normalizeProjectIntake(body);
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
      throw error;
    }
  }
}
